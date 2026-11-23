import { afterEach, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import request from 'supertest';
import { createStore, type StoredState } from '../../server/store';
import { createApp } from '../../server/app';
import { readConfig } from '../../server/config';
import { startServer } from '../../server/index';
import { runCli } from '../../server/cli';
import type { SyncService } from '../../server/sync';
import { normalizeWorkbook } from '../../server/domain/normalize';
import type { MappingDecision, RawWorkbook, Snapshot } from '../../shared/contracts';
import { syntheticWorkbook } from '../domain/fixture';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(p => rm(p, { recursive: true, force: true }))); });
async function privateDir() {
  const base = path.resolve('.private/test-tmp'); await mkdir(base, { recursive: true });
  const dir = await mkdtemp(path.join(base, 'cache-compat-')); roots.push(dir); return dir;
}
const at = '2026-11-20T00:00:00.000Z';
const mappings: MappingDecision[] = [{ id: 'synthetic-mapping', kind: 'agent', alias: 'Legacy Agent', targetId: 'AG_1', reason: 'Synthetic explicit approval', createdAt: at, createdBy: 'synthetic-admin' }];
const refs = ['Crew List Departure', 'Funnel Rekap'];
function rawFixture(): RawWorkbook {
  const raw = syntheticWorkbook(); raw.fetchedAt = at;
  const candidates = raw.sheets.find(s => s.name === 'Data Kandidat')!;
  const yearCandidate = structuredClone(candidates.rows[1]!); yearCandidate.rowNumber = 3;
  yearCandidate.cells[0]!.value = 'DK_002'; yearCandidate.cells[1]!.value = 'Other Master'; yearCandidate.cells[3]!.value = 2024;
  candidates.rows.push(yearCandidate);
  const applications = raw.sheets.find(s => s.name === 'Proses Rekrutment')!;
  applications.rows[1]!.cells[2]!.value = 'Unverified Category'; applications.rows[1]!.cells[4]!.value = 'Legacy Agent';
  const yearApplication = structuredClone(applications.rows[1]!); yearApplication.rowNumber = 3;
  yearApplication.cells[1]!.value = 'DK_002'; yearApplication.cells[2]!.value = 'Unverified Year'; applications.rows.push(yearApplication);
  return raw;
}
/** Independent reproduction of the exact pre-BE001 ID and unique-ID attribute borrowing. */
function legacySnapshot(raw: RawWorkbook, variant: 'borrowed' | 'verified' = 'borrowed'): Snapshot {
  const snapshot = normalizeWorkbook(raw, { referenceTabs: refs, mappings });
  const before = snapshot.id;
  const hash = createHash('sha256').update(JSON.stringify(raw)).digest('hex');
  snapshot.id = 's_' + createHash('sha256').update(hash + JSON.stringify({ referenceTabs: refs, mappings })).digest('hex').slice(0, 24);
  delete (snapshot as Partial<Snapshot> & { normalizationRevision?: string }).normalizationRevision;
  const replace = (id: string) => id.startsWith(before + ':') ? snapshot.id + id.slice(before.length) : id;
  for (const a of snapshot.applications) {
    a.id = replace(a.id);
    if (variant === 'borrowed') {
      const matches = snapshot.candidates.filter(c => c.id === a.candidateId);
      a.candidateGraduationYear = matches.length === 1 ? matches[0]!.graduationYear : null;
      a.candidateCategory = matches.length === 1 ? matches[0]!.category : null;
    }
  }
  for (const d of snapshot.departures) d.id = replace(d.id);
  for (const i of snapshot.issues) { i.id = replace(i.id); if (['application', 'departure', 'reference', 'rejected-row'].includes(i.entityType)) i.entityId = replace(i.entityId); }
  return snapshot;
}
async function seedLegacy(variant: 'borrowed' | 'verified' = 'borrowed') {
  const dir = await privateDir(), raw = rawFixture(), snapshot = legacySnapshot(raw, variant);
  const state: StoredState = { version: 1, raw, snapshot,
    settings: { referenceTabs: refs, syncIntervalMinutes: 47, retentionDays: 91 }, mappings: structuredClone(mappings),
    reviews: [{ snapshotId: snapshot.id, issueId: snapshot.issues[0]!.id, status: 'reviewed', note: 'Synthetic old review', at, by: 'synthetic-admin' }],
    audit: [{ id: 'synthetic-audit', at, actorId: 'synthetic-admin', action: 'issue.review', result: 'ok', details: { snapshotId: snapshot.id } }],
    sync: { state: 'ok', lastAttemptAt: at, lastSuccessAt: at, nextRunAt: null, message: null } };
  const bytes = JSON.stringify(state); await writeFile(path.join(dir, 'state.json'), bytes);
  return { dir, raw, state, bytes };
}

it('cold-loads only the known legacy cache with corrected attributes and a distinct stable snapshot identity without writes', async () => {
  const { dir, state, bytes } = await seedLegacy();
  expect(state.snapshot!.applications.map(a => [a.identityVerified, a.candidateGraduationYear, a.candidateCategory])).toEqual([[false, null, 'Program A'], [false, 2024, null]]);
  const store = await createStore({ directory: dir }), loaded = store.read();
  expect(loaded.snapshot!.applications.map(a => [a.candidateGraduationYear, a.candidateCategory])).toEqual([[null, null], [null, null]]);
  expect(loaded.snapshot!.id).not.toBe(state.snapshot!.id);
  expect(loaded.snapshot!.id).toBe(normalizeWorkbook(state.raw!, { referenceTabs: refs, mappings }).id);
  expect((await createStore({ directory: dir })).read().snapshot!.id).toBe(loaded.snapshot!.id);
  expect({ ...loaded, snapshot: null }).toEqual({ ...state, snapshot: null });
  expect(await readFile(path.join(dir, 'state.json'), 'utf8')).toBe(bytes);
});

it('backs up the complete original state before the first normal atomic write, preserving history and old reviews', async () => {
  const { dir, state, bytes } = await seedLegacy();
  await mkdir(path.join(dir, 'history')); await writeFile(path.join(dir, 'history/untouched.json'), 'SYNTHETIC HISTORY');
  const store = await createStore({ directory: dir, now: () => new Date(at) });
  expect((await readdir(dir)).sort()).toEqual(['history', 'state.json']);
  await store.update(s => { s.settings.syncIntervalMinutes = 48; });
  const names = await readdir(path.join(dir, 'compatibility')); expect(names).toHaveLength(1);
  const backup = path.join(dir, 'compatibility', names[0]!);
  const envelope = JSON.parse(await readFile(backup, 'utf8'));
  expect(envelope).toMatchObject({ format: 'sidaksa-private-backup', version: 1, state });
  expect(JSON.stringify(envelope.state)).toBe(bytes);
  const reopened = await createStore({ directory: dir });
  expect(reopened.read()).toEqual(store.read()); expect(reopened.read().reviews).toEqual(state.reviews);
  expect(reopened.read().reviews[0]!.snapshotId).not.toBe(reopened.read().snapshot!.id);
  expect(await readFile(path.join(dir, 'history/untouched.json'), 'utf8')).toBe('SYNTHETIC HISTORY');
  await reopened.update(s => { s.settings.syncIntervalMinutes = 49; });
  expect(await readdir(path.join(dir, 'compatibility'))).toEqual(names);
  const restored = await createStore({ directory: await privateDir(), now: () => new Date(at) });
  await restored.restore(backup);
  expect(restored.read().snapshot).toEqual(store.read().snapshot);
  for (const key of ['raw', 'settings', 'mappings', 'reviews'] as const) expect(restored.read()[key]).toEqual(state[key]);
  expect(restored.read().audit.slice(0, state.audit.length)).toEqual(state.audit);
  expect(restored.read().audit.at(-1)!.action).toBe('backup.restore');
});

it('does not commit or mutate memory if the prerequisite compatibility backup fails, and retries safely', async () => {
  const { dir, bytes } = await seedLegacy(); const store = await createStore({ directory: dir });
  const before = store.read(), revision = store.revision!();
  await writeFile(path.join(dir, 'compatibility'), 'SYNTHETIC BLOCKER');
  await expect(store.update(s => { s.settings.retentionDays = 92; })).rejects.toThrow();
  expect(store.read()).toEqual(before); expect(store.revision!()).toBe(revision);
  expect(await readFile(path.join(dir, 'state.json'), 'utf8')).toBe(bytes);
  await rm(path.join(dir, 'compatibility'));
  await store.update(s => { s.settings.retentionDays = 92; });
  expect((await createStore({ directory: dir })).read()).toEqual(store.read());
});

it('retains the original backup and in-memory revision when atomic state replacement fails', async () => {
  const { dir, state, bytes } = await seedLegacy(); const store = await createStore({ directory: dir });
  const before = store.read(), file = path.join(dir, 'state.json'), saved = path.join(dir, 'state.saved.json');
  await rename(file, saved); await mkdir(file);
  try {
    await expect(store.update(s => { s.settings.retentionDays = 92; })).rejects.toThrow();
    expect(store.read()).toEqual(before); expect(store.revision!()).toBe(0);
    const names = await readdir(path.join(dir, 'compatibility')); expect(names).toHaveLength(1);
    expect(JSON.parse(await readFile(path.join(dir, 'compatibility', names[0]!), 'utf8')).state).toEqual(state);
    expect((await readdir(dir)).filter(n => n.endsWith('.tmp'))).toEqual([]);
  } finally { await rm(file, { recursive: true }); await rename(saved, file); }
  expect(await readFile(file, 'utf8')).toBe(bytes);
  await store.update(s => { s.settings.retentionDays = 92; });
  expect((await readdir(path.join(dir, 'compatibility')))).toHaveLength(1);
  expect((await createStore({ directory: dir })).read()).toEqual(store.read());
});

it('exports and restores canonical backups without a constructor or CLI-backup write to the legacy cache', async () => {
  const { dir, bytes, state } = await seedLegacy(); const target = path.join(dir, 'export.json');
  const output: string[] = [];
  expect(await runCli(['backup', target], { projectRoot: path.resolve('.'), env: { SIDAKSA_DATA_DIR: dir }, write: s => output.push(s) })).toBe(0);
  expect(await readFile(path.join(dir, 'state.json'), 'utf8')).toBe(bytes);
  expect((await readdir(dir)).sort()).toEqual(['export.json', 'state.json']);
  const envelope = JSON.parse(await readFile(target, 'utf8'));
  expect(envelope.state.snapshot.id).not.toBe(state.snapshot!.id);
  const restored = await createStore({ directory: await privateDir() }); await restored.restore(target);
  expect(restored.read().snapshot).toEqual(envelope.state.snapshot);
  expect(restored.read().reviews).toEqual(state.reviews);
  expect(output.join('')).not.toMatch(/081-PRIVATE|Unverified|SYNTHETIC-UNIT-ONLY/);
});

it('leaves current-revision caches unchanged and recognizes the exact revisionless BE001 representation', async () => {
  const { dir, state } = await seedLegacy('verified');
  const store = await createStore({ directory: dir });
  expect(store.read().snapshot!.id).not.toBe(state.snapshot!.id);
  const canonical = { ...state, snapshot: store.read().snapshot }; const bytes = JSON.stringify(canonical);
  await writeFile(path.join(dir, 'state.json'), bytes);
  const current = await createStore({ directory: dir }); expect(current.read()).toEqual(canonical);
  expect(await readFile(path.join(dir, 'state.json'), 'utf8')).toBe(bytes);
  await current.update(() => {}); expect(await readdir(dir)).toEqual(['state.json']);
});

const corruptions: [string, (s: StoredState) => void][] = [
  ['count', s => { s.snapshot!.counts.applications++; }],
  ['contact', s => { s.snapshot!.candidates[0]!.phone = 'SYNTHETIC TAMPER'; }],
  ['date', s => { s.snapshot!.applications[0]!.appliedAt.iso = '2025-01-02'; }],
  ['source', s => { s.snapshot!.source = 'google-sheets'; }],
  ['spreadsheet', s => { s.raw!.spreadsheetId = 'SYNTHETIC-OTHER-SOURCE'; }],
  ['raw', s => { s.raw!.sheets[0]!.rows[1]!.cells[1]!.value = 'SYNTHETIC TAMPER'; }],
  ['issue', s => { s.snapshot!.issues[0]!.message = 'SYNTHETIC TAMPER'; }],
  ['issue coordinate', s => { s.snapshot!.issues[0]!.source.row++; }],
  ['mapping', s => { s.mappings[0]!.targetId = 'CO_1'; }],
  ['reference approval', s => { s.snapshot!.referenceStats.approvedReferenceTabs = []; }],
  ['attribute mixture', s => { s.snapshot!.applications[0]!.candidateCategory = null; }],
  ['unknown revision', s => { s.snapshot!.normalizationRevision = 'unknown-v999'; }],
  ['malformed snapshot', s => { (s as unknown as { snapshot: unknown }).snapshot = false; }],
  ['bad raw shape', s => { s.raw!.sheets[0]!.rows[1]!.rowNumber = -1; }],
  ['unknown state field', s => { Object.assign(s, { unexpected: 'SYNTHETIC TAMPER' }); }],
];
it.each(corruptions)('refuses unexplained legacy %s changes with the stable STORE_INVALID error', async (_name, corrupt) => {
  const { dir, state } = await seedLegacy(); corrupt(state);
  const bytes = JSON.stringify(state); await writeFile(path.join(dir, 'state.json'), bytes);
  await expect(createStore({ directory: dir })).rejects.toMatchObject({ code: 'STORE_INVALID', status: 503, message: 'Penyimpanan privat tidak valid; pemulihan diperlukan' });
  expect(await readFile(path.join(dir, 'state.json'), 'utf8')).toBe(bytes);
  expect(await readdir(dir)).toEqual(['state.json']);
});

it('cold-starts an isolated real listener, rejects old snapshot-bound reads and reviews, and never retargets reviews', async () => {
  const { dir, state } = await seedLegacy(); const root = await privateDir();
  await mkdir(path.join(root, 'dist/client'), { recursive: true });
  await writeFile(path.join(root, 'dist/client/index.html'), '<!doctype html><title>Synthetic compatibility test</title>');
  const config = { ...readConfig({ SIDAKSA_DATA_DIR: dir, GOOGLE_SPREADSHEET_ID: 'SYNTHETIC-UNIT-ONLY' }), port: 0 };
  const idleSync = { start: async () => {}, stop: async () => {}, reschedule: async () => {} } as unknown as SyncService;
  const app = await createApp({ config, allowFixtureForTests: true, sync: idleSync,
    authenticator: async () => ({ id: 'synthetic-admin', email: 'synthetic@sidaksa.invalid', role: 'admin' }) });
  const running = await startServer({ config, projectRoot: root, app });
  try {
    await running.ready; await request(running.server).get('/api/health').expect(200);
    await request(running.server).get('/api/applications').expect(401);
    const stale = await request(running.server).get('/api/applications?snapshotId=' + state.snapshot!.id).set('Authorization', 'Bearer synthetic').expect(409);
    expect(stale.body.error.code).toBe('SNAPSHOT_CHANGED');
    await request(running.server).get('/api/export?kind=applications&snapshotId=' + state.snapshot!.id).set('Authorization', 'Bearer synthetic').expect(409);
    const rows = await request(running.server).get('/api/applications').set('Authorization', 'Bearer synthetic').expect(200);
    expect(rows.body.rows.every((a: { candidateGraduationYear: unknown; candidateCategory: unknown }) => a.candidateGraduationYear === null && a.candidateCategory === null)).toBe(true);
    const issues = await request(running.server).get('/api/issues').set('Authorization', 'Bearer synthetic').expect(200);
    expect(issues.body.rows.every((i: { status: string }) => i.status === 'open')).toBe(true);
    const review = await request(running.server).post('/api/issues/' + encodeURIComponent(state.reviews[0]!.issueId) + '/review').set('Authorization', 'Bearer synthetic').send({ snapshotId: state.snapshot!.id, status: 'reviewed', note: 'must reject' }).expect(409);
    expect(review.body.error.code).toBe('STALE_SNAPSHOT'); expect(app.locals.sidaksa.store.read().reviews).toEqual(state.reviews);
  } finally { await running.close(); }
});

it('does not publish history or invoke a normal mutator before a required legacy backup succeeds', async () => {
  const { dir, bytes } = await seedLegacy(); const store = await createStore({ directory: dir });
  await writeFile(path.join(dir, 'compatibility'), 'SYNTHETIC BLOCKER');
  let invoked = false;
  await expect(store.update(() => { invoked = true; })).rejects.toThrow(); expect(invoked).toBe(false);
  const raw = rawFixture(), snapshot = normalizeWorkbook(raw, { referenceTabs: refs, mappings });
  await expect(store.publish(raw, snapshot)).rejects.toThrow();
  expect((await readdir(dir)).sort()).toEqual(['compatibility', 'state.json']);
  expect(await readFile(path.join(dir, 'state.json'), 'utf8')).toBe(bytes);
});

it('rejects corrupt legacy backup restore before changing the target and rejects corrupt current-revision caches', async () => {
  const { dir, state } = await seedLegacy(); const target = await createStore({ directory: await privateDir() });
  const raw = syntheticWorkbook(); await target.publish(raw, normalizeWorkbook(raw, { referenceTabs: [], mappings: [] }));
  const before = target.read(), file = path.join(target.directory, 'state.json'), bytes = await readFile(file, 'utf8');
  state.snapshot!.issues[0]!.message = 'SYNTHETIC TAMPER';
  const backup = path.join(dir, 'bad-backup.json');
  await writeFile(backup, JSON.stringify({ format: 'sidaksa-private-backup', version: 1, createdAt: at, state }));
  await expect(target.restore(backup)).rejects.toMatchObject({ code: 'STORE_INVALID' });
  expect(target.read()).toEqual(before); expect(await readFile(file, 'utf8')).toBe(bytes);
  const tampered = structuredClone(before); tampered.snapshot!.applications[0]!.candidateName = 'SYNTHETIC TAMPER';
  await writeFile(file, JSON.stringify(tampered));
  await expect(createStore({ directory: target.directory })).rejects.toMatchObject({ code: 'STORE_INVALID' });
});

it('distinguishes corrupt JSON from filesystem failures without leaking cache values', async () => {
  const dir = await privateDir(), file = path.join(dir, 'state.json');
  await writeFile(file, 'SYNTHETIC SECRET invalid JSON');
  await expect(createStore({ directory: dir })).rejects.toMatchObject({ code: 'STORE_INVALID', message: 'Penyimpanan privat tidak valid; pemulihan diperlukan' });
  await rm(file); await mkdir(file);
  try { await createStore({ directory: dir }); throw new Error('Expected filesystem rejection'); }
  catch (error) { expect((error as { code?: string }).code).not.toBe('STORE_INVALID'); expect((error as { code?: string }).code).toBeTruthy(); }
});
