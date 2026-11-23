import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { createApp } from '../../server/app';
import { ApiError, type Authenticator } from '../../server/auth';
import { readConfig } from '../../server/config';
import { createStore } from '../../server/store';
import { createSyncService } from '../../server/sync';
import { normalizeWorkbook } from '../../server/domain/normalize';
import { syntheticWorkbook } from '../domain/fixture';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(d => rm(d, { recursive: true, force: true }))); });
const origin = 'http://127.0.0.1:3080';
const auth: Authenticator = async token => {
  if (token === 'disabled') throw new ApiError(403, 'ACCOUNT_NOT_APPROVED', 'Akun belum disetujui.');
  if (token === 'offline') throw new Error('SECRET SDK failure C:/private/key.json');
  if (!['admin', 'recruiter', 'leader'].includes(token)) throw new ApiError(401, 'INVALID_TOKEN', 'Sesi tidak valid.');
  return { id: `test-${token}`, email: `${token}@example.invalid`, role: token as 'admin' | 'recruiter' | 'leader' };
};
async function setup(options: { fixture?: boolean; populated?: boolean; references?: string[] } = {}) {
  await mkdir('.private/test-tmp', { recursive: true });
  const directory = await mkdtemp(path.resolve('.private/test-tmp/http-')); directories.push(directory);
  const config = readConfig({ SIDAKSA_DATA_DIR: directory, APP_ORIGIN: origin });
  const store = await createStore({ directory, settings: { referenceTabs: options.references || [] } });
  if (options.populated !== false) {
    const raw = syntheticWorkbook();
    await store.publish(raw, normalizeWorkbook(raw, { referenceTabs: store.read().settings.referenceTabs, mappings: [] }));
  }
  const app = await createApp({ config, store, authenticator: auth, allowFixtureForTests: options.fixture !== false });
  return { app, store, config };
}
const get = (app: Awaited<ReturnType<typeof createApp>>, url: string, role = 'admin') => request(app).get(url).set('Authorization', `Bearer ${role}`);

describe('HTTP snapshot reads and privacy', () => {
  it('serves reconciled lists, details, dictionaries and metadata with server-side leader redaction', async () => {
    const { app, store } = await setup({ references: ['Crew List Departure', 'Funnel Rekap'] });
    const snapshot = store.read().snapshot!;
    const status = await get(app, '/api/status').expect(200);
    expect(status.body).toMatchObject({ sourceMode: 'google-sheets', sheetsConfigured: false, snapshot: { id: snapshot.id, source: 'fixture' } });
    const overview = await get(app, '/api/overview').expect(200);
    expect(overview.body.metrics.find((m: { key: string }) => m.key === 'applications').value).toBe(1);
    expect(overview.body.meta.source).toBe('fixture');
    const dictionaries = await get(app, '/api/dictionaries').expect(200);
    expect(dictionaries.body.agents).toEqual(['Test Agent']);
    for (const url of ['/api/applications', '/api/candidates', '/api/partners?kind=agents', '/api/partners?kind=companies', '/api/departures', '/api/issues']) {
      const result = await get(app, url, 'leader').expect(200);
      expect(result.body.pagination.total).toBeGreaterThan(0);
      expect(result.body.meta.snapshotId).toBe(snapshot.id);
      expect(JSON.stringify(result.body)).not.toMatch(/081-PRIVATE|photo-private|private (candidate|application|company|contact|address)/);
    }
    const application = await get(app, `/api/applications/${encodeURIComponent(snapshot.applications[0]!.id)}`, 'leader').expect(200);
    expect(application.body.row).not.toHaveProperty('notes');
    expect(application.body.candidate).not.toHaveProperty('phone');
    const candidate = await get(app, '/api/candidates/DK_001', 'leader').expect(200);
    expect(candidate.body.row).not.toHaveProperty('photo');
    expect(candidate.body.applications[0]).not.toHaveProperty('notes');
    const recruiter = await get(app, '/api/candidates/DK_001', 'recruiter').expect(200);
    expect(recruiter.body.row.phone).toBe('081-PRIVATE');
    await get(app, '/api/candidates/DOES_NOT_EXIST').expect(404);
    await get(app, '/api/applications/DOES_NOT_EXIST').expect(404);
  });
  it('validates filters, pagination, dates and ordering instead of silently ignoring input', async () => {
    const { app, store } = await setup({ references: ['Crew List Departure'] });
    const raw = syntheticWorkbook();
    const tab = raw.sheets.find(s => s.name === 'Proses Rekrutment')!;
    const row = structuredClone(tab.rows[1]!); row.rowNumber = 3; row.cells[2]!.value = 'Another Person'; row.cells[14]!.value = ''; tab.rows.push(row);
    await store.publish(raw, normalizeWorkbook(raw, { referenceTabs: ['Crew List Departure'], mappings: [] }));
    const search = await get(app, '/api/applications?q=not-present').expect(200);
    expect(search.body.pagination.total).toBe(0);
    const page = await get(app, '/api/applications?limit=1&page=2&sort=candidateName&direction=asc').expect(200);
    expect(page.body.rows.map((r: { candidateName: string }) => r.candidateName)).toEqual(['Test Person']);
    expect(page.body.pagination).toEqual({ page: 2, limit: 1, total: 2, totalPages: 2 });
    const empty = await get(app, '/api/applications?status=__empty__').expect(200);
    expect(empty.body.pagination.total).toBe(1);
    const daily = await get(app, '/api/applications?from=2025-01-10&to=2025-01-20').expect(200);
    expect(daily.body.pagination.total).toBe(0); expect(daily.body.meta.excludedDatePrecision).toBe(2);
    const overview = await get(app, '/api/overview?status=__empty__').expect(200);
    expect(overview.body.metrics.find((m: { key: string }) => m.key === 'applications').value).toBe(1);
    const issues = await get(app, '/api/issues?severity=critical&code=IDENTITY_MISMATCH&reviewStatus=open').expect(200);
    expect(issues.body.pagination.total).toBe(1);
    for (const query of ['limit=101', 'page=0', 'page=1.5', 'page=10001', 'sort=phone', 'direction=sideways', 'from=2025-02-30', 'from=2026-01-01&to=2025-01-01', 'q=x&q=y', 'agent[x]=a', 'unexpected=x', 'q=' + 'a'.repeat(201)]) {
      await get(app, '/api/applications?' + query).expect(400);
    }
    await get(app, '/api/partners?kind=unknown').expect(400);
    await get(app, '/api/candidates?year=Program').expect(400);
    await get(app, '/api/issues?severity=bad').expect(400);
    await get(app, '/api/candidates/DK_001?role=admin').expect(400);
  });
  it('withdraws optional-reference results immediately when their approval is removed', async () => {
    const { app } = await setup({ references: ['Crew List Departure'] });
    expect((await get(app, '/api/overview').expect(200)).body.metrics.find((m: { key: string }) => m.key === 'crew').value).toBe(1);
    await request(app).put('/api/settings').set('Authorization', 'Bearer admin').set('Origin', origin).send({ referenceTabs: [], syncIntervalMinutes: 15, retentionDays: 30 }).expect(200);
    await get(app, '/api/departures').expect(503);
    expect((await get(app, '/api/overview').expect(200)).body.metrics.find((m: { key: string }) => m.key === 'crew').value).toBeNull();
  });
  it('refuses fixture cache unless the factory explicitly permits it and never treats missing references as zero', async () => {
    const production = await setup({ fixture: false });
    await get(production.app, '/api/overview').expect(503);
    const status = await get(production.app, '/api/status').expect(200);
    expect(status.body.snapshot).toBeNull();
    expect(status.body.sync.lastSuccessAt).toBeNull();
    expect(status.body.sync.state).not.toBe('ok');
    await get(production.app, '/api/mappings').expect(503);
    const isolated = await setup();
    await get(isolated.app, '/api/departures').expect(503);
    const overview = await get(isolated.app, '/api/overview').expect(200);
    expect(overview.body.metrics.find((m: { key: string }) => m.key === 'crew').value).toBeNull();
    const empty = await setup({ populated: false });
    await get(empty.app, '/api/applications').expect(503);
  });
});

describe('HTTP admin controls and synchronization', () => {
  it('exercises a real injected synchronization through HTTP, rejects overlap, retains good data and rate-limits refresh', async () => {
    const { store, config } = await setup();
    let release!: () => void, calls = 0;
    const sync = createSyncService({ store, allowFixtureForTests: true, loader: async () => {
      calls++;
      if (calls > 1) throw new Error('SECRET SOURCE SDK key C:/private/google-key.json');
      await new Promise<void>(resolve => { release = resolve; });
      return { ...syntheticWorkbook(), fetchedAt: '2026-11-10T00:00:00.000Z' };
    } });
    const app = await createApp({ config, store, authenticator: auth, sync, allowFixtureForTests: true });
    const post = () => request(app).post('/api/sync').set('Authorization', 'Bearer admin').set('Origin', origin).send({});
    const pending = post().then(response => response);
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    await post().expect(409);
    await request(app).put('/api/settings').set('Authorization', 'Bearer admin').set('Origin', origin).send({ referenceTabs: [], syncIntervalMinutes: 20, retentionDays: 7 }).expect(409);
    release(); const result = await pending; expect(result.status).toBe(200); expect(result.body.snapshot.source).toBe('fixture');
    const goodId = store.read().snapshot!.id;
    const failure = await post().expect(503); expect(JSON.stringify(failure.body)).not.toMatch(/SECRET|google-key/);
    expect(store.read().snapshot!.id).toBe(goodId);
    await post().expect(429);
    expect(calls).toBe(2);
  });
  it('enforces admin, same-origin and strict bounded settings while persisting the allowed fields', async () => {
    const { app, store } = await setup();
    for (const url of ['/api/settings', '/api/mappings', '/api/audit']) await get(app, url, 'recruiter').expect(403);
    const settings = await get(app, '/api/settings').expect(200);
    expect(settings.body).toMatchObject({ sourceMode: 'google-sheets', requiredTabs: ['Data Kandidat', 'Data Mitra Agent', 'Data Company', 'Proses Rekrutment'], syncIntervalMinutes: 15, credentialConfigured: false });
    expect(settings.body).not.toHaveProperty('credentialFile');
    const payload = { referenceTabs: ['Crew List Departure'], syncIntervalMinutes: 30, retentionDays: 7 };
    await request(app).put('/api/settings').set('Authorization', 'Bearer leader').set('Origin', origin).send(payload).expect(403);
    await request(app).put('/api/settings').set('Authorization', 'Bearer admin').set('Origin', 'https://evil.example').send(payload).expect(403);
    await request(app).put('/api/settings').set('Authorization', 'Bearer admin').set('Origin', origin).send({ ...payload, spreadsheetId: 'OVERRIDE' }).expect(400);
    await request(app).put('/api/settings').set('Authorization', 'Bearer admin').set('Origin', origin).send({ ...payload, referenceTabs: ['Crew List Departure', 'Crew List Departure'] }).expect(400);
    const saved = await request(app).put('/api/settings').set('Authorization', 'Bearer admin').set('Origin', origin).send(payload).expect(200);
    expect(saved.body).toMatchObject(payload); expect(store.read().settings).toEqual(payload);
    expect((await get(app, '/api/settings').expect(200)).body).toMatchObject(payload);
    expect((await get(app, '/api/audit').expect(200)).body.rows.some((r: { action: string }) => r.action === 'settings.update')).toBe(true);
    await request(app).put('/api/settings').set('Authorization', 'Bearer admin').set('Origin', origin).set('Content-Type', 'application/json').send('{"invalid"').expect(400);
    const large = await request(app).put('/api/settings').set('Authorization', 'Bearer admin').set('Origin', origin).send({ referenceTabs: [], note: 'SECRET'.repeat(5000) }).expect(413);
    expect(large.body.error.message).not.toContain('SECRET');
    expect((await get(app, '/api/mappings').expect(200)).body).toEqual({ rows: [] });
  });
  it('publishes version-scoped explicit mappings atomically without modifying source values', async () => {
    const { app, store } = await setup();
    const raw = syntheticWorkbook(); raw.sheets.find(s => s.name === 'Proses Rekrutment')!.rows[1]!.cells[4]!.value = 'Unmatched Agent';
    await store.publish(raw, normalizeWorkbook(raw, { referenceTabs: [], mappings: [] }));
    const before = store.read(), originalRaw = JSON.stringify(before.raw);
    const payload = { kind: 'agent', alias: 'Unmatched Agent', targetId: 'AG_1', reason: 'Approved explicit alias', snapshotId: before.snapshot!.id };
    const post = (value: Record<string, unknown>, role = 'admin') => request(app).post('/api/mappings').set('Authorization', `Bearer ${role}`).set('Origin', origin).send(value);
    await post(payload, 'recruiter').expect(403);
    await post({ ...payload, snapshotId: 'stale' }).expect(409);
    await post({ ...payload, targetId: 'MISSING' }).expect(400);
    await post({ ...payload, alias: 'Test Agent' }).expect(409);
    const result = await post(payload).expect(201);
    expect(result.body.snapshotId).not.toBe(before.snapshot!.id);
    expect(store.read().snapshot!.applications[0]!.agentId).toBe('AG_1');
    expect(JSON.stringify(store.read().raw)).toBe(originalRaw);
    expect(store.read().snapshot!.createdAt).toBe(before.snapshot!.createdAt);
    expect((await get(app, '/api/mappings').expect(200)).body.rows[0]).toMatchObject({ alias: 'Unmatched Agent', targetId: 'AG_1', createdBy: 'test-admin' });
    await post({ ...payload, snapshotId: result.body.snapshotId }).expect(409);
    const reloaded = await createStore({ directory: store.directory });
    expect(reloaded.read().snapshot!.id).toBe(result.body.snapshotId);
    expect((await get(app, '/api/audit?q=mapping').expect(200)).body.pagination.total).toBe(1);
  });
  it('allows an approved ambiguous-name mapping only when its target ID is unique', async () => {
    const { app, store } = await setup();
    const raw = syntheticWorkbook(), agents = raw.sheets.find(s => s.name === 'Data Mitra Agent')!;
    const duplicateName = structuredClone(agents.rows[1]!); duplicateName.rowNumber = 3; duplicateName.cells[0]!.value = 'AG_2'; agents.rows.push(duplicateName);
    await store.publish(raw, normalizeWorkbook(raw, { referenceTabs: [], mappings: [] }));
    const state = store.read(); expect(state.snapshot!.applications[0]!.agentId).toBeNull();
    await request(app).post('/api/mappings').set('Authorization', 'Bearer admin').set('Origin', origin).send({ kind: 'agent', alias: 'Test Agent', targetId: 'AG_1', reason: 'Explicitly reviewed same-name masters', snapshotId: state.snapshot!.id }).expect(201);
    expect(store.read().snapshot!.applications[0]!.agentId).toBe('AG_1');
  });
  it('keeps issue reviews snapshot-scoped and strips free-text review notes from leader payloads', async () => {
    const { app, store } = await setup();
    const original = store.read().snapshot!, issue = original.issues.find(i => i.entityType === 'application')!;
    const url = `/api/issues/${encodeURIComponent(issue.id)}/review`;
    const post = (payload: Record<string, unknown>, role = 'admin') => request(app).post(url).set('Authorization', `Bearer ${role}`).set('Origin', origin).send(payload);
    const payload = { status: 'reviewed', note: 'PRIVATE REVIEW contact 081-note', snapshotId: original.id };
    await post(payload, 'leader').expect(403);
    await post({ ...payload, snapshotId: 'stale' }).expect(409);
    await post({ ...payload, status: 'made-up' }).expect(400);
    await post(payload).expect(200);
    expect(store.read().snapshot).toEqual(original);
    const reviewed = await get(app, '/api/issues?reviewStatus=reviewed').expect(200);
    expect(reviewed.body.rows).toHaveLength(1); expect(reviewed.body.rows[0].reviewNote).toBe(payload.note);
    const leader = await get(app, '/api/issues?reviewStatus=reviewed', 'leader').expect(200);
    expect(leader.body.rows[0]).not.toHaveProperty('reviewNote');
    expect(JSON.stringify(leader.body)).not.toContain('081-note');
    const detail = await get(app, `/api/applications/${encodeURIComponent(original.applications[0]!.id)}`, 'leader').expect(200);
    expect(JSON.stringify(detail.body)).not.toContain('PRIVATE REVIEW');
    expect(store.read().audit.find(a => a.action === 'issue.review')?.details).not.toHaveProperty('note');
    const next = syntheticWorkbook(); next.fetchedAt = '2026-11-10T00:00:00.000Z';
    await store.publish(next, normalizeWorkbook(next, { referenceTabs: [], mappings: [] }));
    expect((await get(app, '/api/issues?reviewStatus=reviewed').expect(200)).body.pagination.total).toBe(0);
    await post(payload).expect(409);
  });
  it('reports real unconfigured sync failure without discarding the previous snapshot or exposing source errors', async () => {
    const { app, store } = await setup();
    const id = store.read().snapshot!.id;
    await request(app).post('/api/sync').set('Authorization', 'Bearer recruiter').set('Origin', origin).send({}).expect(403);
    await request(app).post('/api/sync').set('Authorization', 'Bearer admin').set('Origin', origin).send({ source: 'fixture' }).expect(400);
    const failure = await request(app).post('/api/sync').set('Authorization', 'Bearer admin').set('Origin', origin).send({}).expect(503);
    expect(failure.body.error.code).toBe('SHEETS_UNCONFIGURED');
    expect(store.read().snapshot!.id).toBe(id);
    expect((await get(app, '/api/status').expect(200)).body.sync.state).toBe('failed');
  });
});

describe('HTTP CSV reconciliation and permissions', () => {
  it('preserves the explicit workbook source label in CSV rather than serializing a SourceRef object', async () => {
    const { app } = await setup();
    const csv = await get(app, '/api/export?kind=applications').expect(200);
    expect(csv.text.trim().split('\r\n')[1]?.split(',')[2]).toBe('"fixture"');
  });
  it('exports the same filtered snapshot, excludes contacts by default and limits leaders to aggregate CSV', async () => {
    const { app, store } = await setup({ references: ['Crew List Departure'] });
    const snapshot = store.read().snapshot!;
    const csv = await get(app, '/api/export?kind=applications&finalResult=Lolos', 'recruiter').expect(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.headers['content-disposition']).toContain('attachment');
    expect(csv.text).toContain(snapshot.id); expect(csv.text).toContain('unit_definition');
    expect(csv.text.trim().split('\r\n')).toHaveLength(2);
    expect(csv.text).not.toMatch(/081-PRIVATE|private application notes|private candidate notes/);
    const contact = await get(app, '/api/export?kind=candidates&contacts=true', 'recruiter').expect(200);
    expect(contact.text).toContain('081-PRIVATE'); expect(contact.text).not.toContain('photo-private');
    for (const kind of ['applications', 'candidates', 'partners', 'departures']) await get(app, `/api/export?kind=${kind}`, 'leader').expect(403);
    const aggregate = await get(app, '/api/export?kind=aggregate', 'leader').expect(200);
    expect(aggregate.text).not.toMatch(/081-PRIVATE|private contact|private candidate notes/);
    await get(app, '/api/export?kind=aggregate&contacts=true', 'leader').expect(403);
    const none = await get(app, '/api/export?kind=applications&q=absent').expect(200);
    expect(none.text.trim().split('\r\n')).toHaveLength(2);
    expect(none.text).toContain('"record_type"');
    expect(none.text).toContain('"metadata","0"');
    expect(none.text).not.toContain('"candidateName"');
    const precision = await get(app, '/api/export?kind=applications&from=2025-01-10&to=2025-01-20').expect(200);
    expect(precision.text.trim().split('\r\n')).toHaveLength(2);
    expect(precision.text).toContain('"excluded_date_precision"');
    expect(precision.text).not.toContain('"candidateName"');
    await get(app, '/api/export?kind=unknown').expect(400);
    await get(app, '/api/export?kind=candidates&contacts=yes').expect(400);
    expect(store.read().audit.some(a => a.action === 'export.csv' && a.details.kind === 'applications')).toBe(true);
  });
  it('preserves conjunctive metric drilldown filters in API metadata and CSV', async () => {
    const { app } = await setup();
    const filtered = await get(app, '/api/applications?status=Completed&metric=passed,inProgress').expect(200);
    expect(filtered.body.pagination.total).toBe(0);
    expect(filtered.body.meta.filters).toEqual({ status: 'Completed', metric: 'passed,inProgress' });
    const csv = await get(app, '/api/export?kind=applications&status=Completed&metric=passed').expect(200);
    expect(csv.text).toContain('passed'); expect(csv.text).toContain('Completed');
    for (const metric of ['', 'passed,passed', 'unknown', 'passed,inProgress,emptyStatus,passed']) await get(app, '/api/applications?metric=' + metric).expect(400);
  });
});

describe('HTTP identity and safe configuration', () => {
  it('exposes only minimal setup publicly and authenticates every private API', async () => {
    const { app } = await setup({ populated: false });
    const health = await request(app).get('/api/health').expect(200);
    expect(health.body).toEqual({ status: 'ok' });
    const config = await request(app).get('/api/public-config').expect(200);
    expect(config.body).toMatchObject({ appName: 'SIDAKSA', authConfigured: false, supabaseUrl: null, supabasePublishableKey: null });
    for (const url of ['/api/me', '/api/status', '/api/applications', '/api/unknown']) {
      await request(app).get(url).expect(401);
    }
    const me = await get(app, '/api/me', 'leader').expect(200);
    expect(me.body.permissions).toEqual({ viewContact: false, manageData: false, exportDetail: false });
    expect(me.headers['cache-control']).toContain('no-store');
    await get(app, '/api/me', 'disabled').expect(403);
    const error = await get(app, '/api/me', 'offline').expect(503);
    expect(JSON.stringify(error.body)).not.toContain('SECRET');
    expect(JSON.stringify(error.body)).not.toContain('key.json');
  });
});
