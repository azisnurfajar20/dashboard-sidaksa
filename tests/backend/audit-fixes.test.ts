import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import type { RawWorkbook } from '../../shared/contracts';
import { createApp } from '../../server/app';
import { ApiError, type Authenticator } from '../../server/auth';
import { readConfig } from '../../server/config';
import { createStore } from '../../server/store';
import { createSyncService } from '../../server/sync';
import { normalizeWorkbook } from '../../server/domain/normalize';
import { syntheticWorkbook } from '../domain/fixture';

// No index, dotenv, operational state, credentials or external source.
const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const auth: Authenticator = async token => {
  if (!['admin', 'recruiter', 'leader'].includes(token)) throw new ApiError(401, 'INVALID_TOKEN', 'Invalid synthetic token');
  return { id: `synthetic-${token}`, email: `${token}@example.invalid`, role: token as 'admin' | 'recruiter' | 'leader' };
};
async function setup(raw: RawWorkbook | null = syntheticWorkbook(), fixture = true) {
  await mkdir('.private/test-tmp', { recursive: true });
  const directory = await mkdtemp(path.resolve('.private/test-tmp/backend-fixes-'));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const store = await createStore({ directory, settings: { referenceTabs: ['Crew List Departure'] } });
  if (raw) await store.publish(raw, normalizeWorkbook(raw, { referenceTabs: ['Crew List Departure'], mappings: [] }), 'synthetic-test');
  const sync = createSyncService({ store, allowFixtureForTests: true, loader: async () => { throw new Error('synthetic offline'); } });
  cleanups.push(() => sync.stop());
  const config = readConfig({ SIDAKSA_DATA_DIR: directory, APP_ORIGIN: 'http://127.0.0.1:43987' });
  const app = await createApp({ config, store, sync, authenticator: auth, allowFixtureForTests: fixture, now: () => new Date('2026-11-19T00:00:00.000Z') });
  return { app, store, sync };
}
const get = (app: Awaited<ReturnType<typeof createApp>>, url: string, role = 'admin') => request(app).get(url).set('Authorization', `Bearer ${role}`);
function set(raw: RawWorkbook, tab: string, row: number, header: string, value: string | number | null) {
  const sheet = raw.sheets.find(s => s.name === tab)!;
  const col = sheet.rows[0]!.cells.findIndex(c => c.value === header);
  expect(col).toBeGreaterThanOrEqual(0);
  sheet.rows[row]!.cells[col] = { value };
}
function duplicate(raw: RawWorkbook, tab: string) {
  const sheet = raw.sheets.find(s => s.name === tab)!;
  const row = structuredClone(sheet.rows[1]!);
  row.rowNumber = sheet.rows.length + 1;
  sheet.rows.push(row);
  return sheet.rows.length - 1;
}
function csvRows(input: string): Record<string, string>[] {
  const records: string[][] = []; let row: string[] = [], field = '', quoted = false;
  const text = input.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '"') { if (quoted && text[i + 1] === '"') { field += '"'; i++; } else quoted = !quoted; }
    else if (ch === ',' && !quoted) { row.push(field); field = ''; }
    else if ((ch === '\r' || ch === '\n') && !quoted) { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(field); records.push(row); row = []; field = ''; }
    else field += ch;
  }
  if (row.length || field) records.push([...row, field]);
  const headers = records.shift() || [];
  return records.map(record => Object.fromEntries(headers.map((h, i) => [h, record[i] || ''])));
}

describe('verified backend audit regressions (synthetic only)', () => {
  it('BACKEND001 quarantines unverified master demographics without repairing literal IDs or disclosing contacts', async () => {
    for (const graduation of [2025, 'Program A']) {
      for (const identity of ['mismatch', 'unknown-token', 'duplicate-master']) {
        const raw = syntheticWorkbook();
        set(raw, 'Data Kandidat', 1, 'Tahun Lulus', graduation);
        const literalId = identity === 'unknown-token' ? ' DK_001 ' : 'DK_001';
        set(raw, 'Proses Rekrutment', 1, 'ID Kandidat', literalId);
        if (identity === 'mismatch') set(raw, 'Proses Rekrutment', 1, 'Nama Kandidat', 'Different Person');
        if (identity === 'duplicate-master') duplicate(raw, 'Data Kandidat');
        const { app } = await setup(raw);
        const all = await get(app, '/api/applications').expect(200);
        const row = all.body.rows[0];
        expect(row).toMatchObject({ candidateId: literalId, identityVerified: false, candidateGraduationYear: null, candidateCategory: null });
        expect(row.issueCodes).toContain(identity === 'unknown-token' ? 'CANDIDATE_NOT_FOUND' : 'IDENTITY_MISMATCH');
        const cohort = typeof graduation === 'number' ? 'year=2025' : 'category=Program%20A';
        expect((await get(app, '/api/applications?' + cohort).expect(200)).body.pagination.total).toBe(0);
        const excluded = await get(app, '/api/export?kind=applications&' + cohort).expect(200);
        expect(excluded.text).not.toContain(row.id);
        const detail = await get(app, '/api/applications/' + encodeURIComponent(row.id)).expect(200);
        expect(detail.body.candidate).toBeNull();
        const csv = await get(app, '/api/export?kind=applications&contacts=true').expect(200);
        expect(csvRows(csv.text)[0]).toMatchObject({ candidateId: literalId, identityVerified: 'false', phone: '' });
        expect(csv.text).not.toContain('081-PRIVATE');
      }
    }
  });
  it('BACKEND001 retains verified master graduation and category cohorts', async () => {
    for (const graduation of [2025, 'Program A']) {
      const raw = syntheticWorkbook(); set(raw, 'Data Kandidat', 1, 'Tahun Lulus', graduation);
      const { app } = await setup(raw);
      const cohort = typeof graduation === 'number' ? 'year=2025' : 'category=Program%20A';
      const result = await get(app, '/api/applications?' + cohort).expect(200);
      expect(result.body.pagination.total).toBe(1);
      expect(result.body.rows[0].identityVerified).toBe(true);
      expect(csvRows((await get(app, '/api/export?kind=applications&' + cohort).expect(200)).text)).toHaveLength(1);
    }
  });
  it('BACKEND002 reads persisted admin audit before the first successful snapshot with honest source-independent metadata', async () => {
    const { app, store, sync } = await setup(null);
    await expect(sync.refresh('synthetic-admin')).rejects.toMatchObject({ code: 'SYNC_FAILED' });
    const persisted = store.read().audit.filter(a => a.result === 'failed');
    expect(persisted).toHaveLength(1);
    const response = await get(app, '/api/audit?q=sync&limit=1').expect(200);
    expect(response.body.rows).toEqual(persisted);
    expect(response.body.pagination).toEqual({ page: 1, limit: 1, total: 1, totalPages: 1 });
    expect(response.body.meta).toEqual({ kind: 'audit', generatedAt: '2026-11-19T00:00:00.000Z', filters: { q: 'sync' }, sourceSnapshot: null });
    expect(JSON.stringify(response.body)).not.toContain('synthetic offline');
    await request(app).get('/api/audit').expect(401);
    for (const role of ['recruiter', 'leader']) await get(app, '/api/audit', role).expect(403);
    await get(app, '/api/audit?snapshotId=stale').expect(503);
    await get(app, '/api/audit?country=ID').expect(400);
    await get(app, '/api/audit?sort=details').expect(400);
    const page2 = await get(app, '/api/audit?q=sync&page=2&limit=1').expect(200);
    expect(page2.body.rows).toEqual([]);
  });
  it('BACKEND002 retains supplied snapshot preconditions and never labels unavailable source context as current', async () => {
    const { app, store } = await setup();
    const s = store.read().snapshot!;
    const response = await get(app, '/api/audit?snapshotId=' + s.id).expect(200);
    expect(response.body.meta.sourceSnapshot).toEqual({ snapshotId: s.id, source: 'fixture', createdAt: s.createdAt });
    await get(app, '/api/audit?snapshotId=stale').expect(409);
    const hidden = await setup(syntheticWorkbook(), false);
    const unavailable = await get(hidden.app, '/api/audit').expect(200);
    expect(unavailable.body.rows.length).toBeGreaterThan(0);
    expect(unavailable.body.meta.sourceSnapshot).toBeNull();
    await get(hidden.app, '/api/audit?snapshotId=' + hidden.store.read().snapshot!.id).expect(503);
  });
  it('BACKEND003 applies country and issue only to partner masters, not to linked application cohorts', async () => {
    const raw = syntheticWorkbook();
    set(raw, 'Proses Rekrutment', 1, 'Negara', 'JP');
    set(raw, 'Data Company', 1, 'Negara', 'SG');
    set(raw, 'Proses Rekrutment', 1, 'Nama Kandidat', 'Different Person');
    const { app } = await setup(raw);
    for (const [kind, country] of [['agents', 'ID'], ['companies', 'SG']]) {
      for (const filter of [`country=${country}`, 'issue=false', `country=${country}&issue=false&status=Completed&from=2025-01-01&to=2025-01-31`]) {
        const result = await get(app, `/api/partners?kind=${kind}&${filter}`).expect(200);
        expect(result.body.rows).toHaveLength(1);
        expect(result.body.rows[0]).toMatchObject({ applicationCount: 1, passedCount: 1, unknownResultCount: 0 });
        const csv = await get(app, `/api/export?kind=partners&partnerKind=${kind}&${filter}`).expect(200);
        expect(csvRows(csv.text).map(p => [p.id, Number(p.applicationCount)])).toEqual(result.body.rows.map((p: { id: string; applicationCount: number }) => [p.id, p.applicationCount]));
      }
      expect((await get(app, `/api/partners?kind=${kind}&country=JP`).expect(200)).body.rows).toEqual([]);
      expect((await get(app, `/api/partners?kind=${kind}&issue=IDENTITY_MISMATCH`).expect(200)).body.rows).toEqual([]);
      expect((await get(app, `/api/partners?kind=${kind}&country=${country}&status=In%20Progress`).expect(200)).body.rows[0].applicationCount).toBe(0);
    }
  });
  it('BACKEND003 treats unresolved groups as explicit synthetic master rows, never as filtered-out mapped partners', async () => {
    const raw = syntheticWorkbook();
    const row = duplicate(raw, 'Proses Rekrutment');
    set(raw, 'Proses Rekrutment', row, 'Agent', 'Unknown Agent');
    set(raw, 'Proses Rekrutment', row, 'Company', 'Unknown Company');
    set(raw, 'Proses Rekrutment', row, 'Negara', 'JP');
    const { app } = await setup(raw);
    for (const kind of ['agents', 'companies']) {
      const unfiltered = await get(app, `/api/partners?kind=${kind}`).expect(200);
      expect(unfiltered.body.rows.map((p: { applicationCount: number }) => p.applicationCount)).toEqual([1, 1]);
      for (const [filter, ids] of [
        ['country=ID', [kind === 'agents' ? 'AG_1' : 'CO_1']],
        ['country=JP', []], ['issue=false', [kind === 'agents' ? 'AG_1' : 'CO_1']],
        ['country=__empty__&issue=UNMAPPED_GROUP', ['__unmapped__']],
        ['issue=true', ['__unmapped__']], ['issue=DATE_MONTH_ONLY', []],
        ['q=Tidak%20terpetakan', ['__unmapped__']], ['q=Test%20Person', []],
      ] as [string, string[]][]) {
        const table = await get(app, `/api/partners?kind=${kind}&${filter}`).expect(200);
        expect(table.body.rows.map((p: { id: string }) => p.id), filter).toEqual(ids);
        const csv = await get(app, `/api/export?kind=partners&partnerKind=${kind}&${filter}`).expect(200);
        // Empty CSV metadata is covered independently by BACKEND006.
        expect(csvRows(csv.text).filter(p => p.id).map(p => p.id), filter).toEqual(ids);
      }
    }
  });
  it('BACKEND004 sorts final recomputed partner counts identically in table and CSV, including unresolved groups', async () => {
    const raw = syntheticWorkbook();
    set(raw, 'Proses Rekrutment', 1, 'Tanggal Apply', '10 Januari 2025');
    for (const [tab, idHeader, nameHeader, id, name] of [
      ['Data Mitra Agent', 'Id_Agent', 'Nama Agent', 'AG_2', 'Second Agent'],
      ['Data Company', 'Id_Company', 'Nama Company', 'CO_2', 'Second Company'],
    ]) {
      const row = duplicate(raw, tab!); set(raw, tab!, row, idHeader!, id!); set(raw, tab!, row, nameHeader!, name!);
    }
    for (let i = 0; i < 4; i++) {
      const row = duplicate(raw, 'Proses Rekrutment');
      set(raw, 'Proses Rekrutment', row, 'Agent', i < 2 ? 'Second Agent' : 'Unknown Agent');
      set(raw, 'Proses Rekrutment', row, 'Company', i < 2 ? 'Second Company' : 'Unknown Company');
      set(raw, 'Proses Rekrutment', row, 'Tanggal Apply', i < 2 ? '10 Desember 2024' : '12 Januari 2025');
      set(raw, 'Proses Rekrutment', row, 'Final Result', i < 2 ? 'Lolos' : '');
    }
    const { app, store } = await setup(raw);
    for (const kind of ['agents', 'companies']) {
      for (const sort of ['applicationCount', 'passedCount', 'unknownResultCount']) {
        for (const direction of ['asc', 'desc']) {
          const filter = `from=2025-01-01&to=2025-01-31&sort=${sort}&direction=${direction}&snapshotId=${store.read().snapshot!.id}`;
          const table = await get(app, `/api/partners?kind=${kind}&${filter}`).expect(200);
          const csv = await get(app, `/api/export?kind=partners&partnerKind=${kind}&${filter}`).expect(200);
          const values = (p: Record<string, unknown>) => [p.id, Number(p.applicationCount), Number(p.passedCount), Number(p.unknownResultCount)];
          expect(csvRows(csv.text).map(values), `${kind}/${sort}/${direction}`).toEqual(table.body.rows.map(values));
          expect(table.body.rows).toHaveLength(3);
          if (sort === 'applicationCount' && direction === 'desc') expect(table.body.rows.map((p: { id: string }) => p.id)).toEqual(['__unmapped__', kind === 'agents' ? 'AG_1' : 'CO_1', kind === 'agents' ? 'AG_2' : 'CO_2']);
        }
      }
    }
  });
  it('BACKEND006 reconciles empty metadata-only exports and unchanged nonempty business rows for every detailed CSV kind', async () => {
    const { app, store } = await setup();
    const snapshot = store.read().snapshot!;
    for (const kind of ['applications', 'candidates', 'departures', 'partners']) {
      const listPath = kind === 'partners' ? '/api/partners?kind=agents' : `/api/${kind}?`;
      const separator = kind === 'partners' ? '&' : '';
      const table = await get(app, `${listPath}${separator}q=no-synthetic-match&snapshotId=${snapshot.id}`).expect(200);
      expect(table.body.pagination.total).toBe(0);
      const response = await get(app, `/api/export?kind=${kind}&q=no-synthetic-match&snapshotId=${snapshot.id}&contacts=true`).expect(200);
      const records = csvRows(response.text);
      expect(records).toHaveLength(1);
      expect(records[0]).toEqual({
        snapshot_id: snapshot.id, snapshot_at: snapshot.createdAt, source: 'fixture', filters: JSON.stringify({ q: 'no-synthetic-match' }),
        unit_definition: expect.any(String), record_type: 'metadata', business_row_count: '0', export_kind: kind,
        partner_kind: kind === 'partners' ? 'agents' : '', excluded_date_precision: String(table.body.meta.excludedDatePrecision),
      });
      expect(response.text).not.toMatch(/081-PRIVATE|private contact|private application notes|private candidate notes/);
      expect(records[0]).not.toHaveProperty('id');
      expect(records[0]).not.toHaveProperty('phone');
      const nonemptyTable = await get(app, listPath).expect(200);
      const nonempty = await get(app, `/api/export?kind=${kind}&snapshotId=${snapshot.id}`).expect(200);
      const business = csvRows(nonempty.text);
      expect(business).toHaveLength(nonemptyTable.body.pagination.total);
      expect(business.map(r => r.id)).toEqual(nonemptyTable.body.rows.map((r: { id: string }) => r.id));
      for (const row of business) {
        expect(row.snapshot_id).toBe(snapshot.id); expect(row.source).toBe('fixture');
        expect(row).not.toHaveProperty('record_type'); expect(row).not.toHaveProperty('business_row_count');
      }
    }
    const aggregate = csvRows((await get(app, '/api/export?kind=aggregate&q=no-synthetic-match', 'leader').expect(200)).text);
    expect(aggregate).toHaveLength(6);
    expect(aggregate.find(r => r.key === 'applications')!.value).toBe('0');
    expect(aggregate.every(r => !r.record_type)).toBe(true);
  });
  it('BACKEND006 carries actual partial-date exclusions and preserves CSV formula/contact safety', async () => {
    const raw = syntheticWorkbook();
    set(raw, 'Crew List Departure', 1, 'Tanggal Berangkat', 'Januari 2025');
    set(raw, 'Proses Rekrutment', 1, 'Nama Kandidat', '=SYNTHETIC("quoted",1)');
    const { app } = await setup(raw);
    for (const kind of ['applications', 'departures']) {
      const filter = 'from=2025-01-10&to=2025-01-20';
      const table = await get(app, `/api/${kind}?${filter}`).expect(200);
      expect(table.body.pagination.total).toBe(0); expect(table.body.meta.excludedDatePrecision).toBe(1);
      const rows = csvRows((await get(app, `/api/export?kind=${kind}&${filter}`).expect(200)).text);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ record_type: 'metadata', business_row_count: '0', excluded_date_precision: '1' });
      expect(JSON.parse(rows[0]!.filters!)).toEqual({ from: '2025-01-10', to: '2025-01-20' });
    }
    const nonempty = await get(app, '/api/export?kind=applications&contacts=true').expect(200);
    expect(csvRows(nonempty.text)[0]).toMatchObject({ candidateName: '\'=SYNTHETIC("quoted",1)', phone: '' });
    expect(nonempty.text).not.toContain('081-PRIVATE');
    const empty = csvRows((await get(app, '/api/export?kind=applications&q=%3Dmissing').expect(200)).text);
    expect(JSON.parse(empty[0]!.filters!)).toEqual({ q: '=missing' });
    await get(app, '/api/export?kind=applications&q=absent', 'leader').expect(403);
  });
});
