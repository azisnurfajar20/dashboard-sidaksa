import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import type { RawWorkbook } from '../../shared/contracts';
import { createApp } from '../../server/app';
import { readConfig } from '../../server/config';
import { normalizeWorkbook } from '../../server/domain/normalize';
import { createStore, type Store } from '../../server/store';
import { createSyncService } from '../../server/sync';
import { syntheticWorkbook } from '../domain/fixture';

const directories: string[] = [];
const sourceA = 'SYNTHETIC-SOURCE-A';
const sourceB = 'SYNTHETIC-SOURCE-B';
const now = () => new Date('2026-11-12T00:00:00.000Z');
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))); });
async function privateStore() {
  await mkdir('.private/test-tmp', { recursive: true });
  const directory = await mkdtemp(path.resolve('.private/test-tmp/mapping-source-'));
  directories.push(directory);
  return createStore({ directory, now });
}
function workbook(spreadsheetId = sourceA, source: RawWorkbook['source'] = 'google-sheets'): RawWorkbook {
  const raw = syntheticWorkbook();
  raw.source = source; raw.spreadsheetId = spreadsheetId;
  raw.sheets.find(sheet => sheet.name === 'Data Mitra Agent')!.rows[1]!.cells[1] = { value: spreadsheetId === sourceA ? 'Source A Agent' : 'Different Source B Agent' };
  raw.sheets.find(sheet => sheet.name === 'Proses Rekrutment')!.rows[1]!.cells[4] = { value: 'Legacy alias' };
  return raw;
}
async function appFor(store: Store, spreadsheetId = sourceA) {
  return createApp({ store, config: readConfig({ SIDAKSA_DATA_DIR: store.directory, GOOGLE_SPREADSHEET_ID: spreadsheetId }), now,
    authenticator: async token => ({ id: 'synthetic-' + token, email: 'synthetic@sidaksa.invalid', role: token === 'admin' ? 'admin' : 'recruiter' }) });
}
const get = (app: Awaited<ReturnType<typeof appFor>>, url: string, token = 'admin') => request(app).get(url).set('Authorization', `Bearer ${token}`);
async function approvedA() {
  const store = await privateStore(), raw = workbook();
  await store.publish(raw, normalizeWorkbook(raw, { referenceTabs: [], mappings: [] }));
  const app = await appFor(store);
  await request(app).post('/api/mappings').set('Authorization', 'Bearer admin').send({ kind: 'agent', alias: 'Legacy alias', targetId: 'AG_1', reason: 'Synthetic source A explicit review only', snapshotId: store.read().snapshot!.id }).expect(201);
  expect(store.read().snapshot!.applications[0]!.agentId).toBe('AG_1');
  return { store, app, raw };
}

describe('persisted mapping source boundary', () => {
  it('checks the mapping source inside the serialized publication queue', async () => {
    const { store: approved } = await approvedA();
    const mappings = approved.read().mappings;
    const store = await privateStore(), rawA = workbook(), rawB = workbook(sourceB);
    await store.publish(rawA, normalizeWorkbook(rawA, { referenceTabs: [], mappings: [] }));
    const approval = store.update(state => {
      state.mappings = mappings;
      state.snapshot = normalizeWorkbook(rawA, { referenceTabs: [], mappings });
    });
    const publication = store.publish(rawB, normalizeWorkbook(rawB, { referenceTabs: [], mappings }));
    await approval;
    await expect(publication).rejects.toMatchObject({ code: 'MAPPING_SOURCE_MISMATCH' });
    expect(store.read().raw).toEqual(rawA);
    expect(store.read().mappings).toEqual(mappings);
    expect((await createStore({ directory: store.directory, now })).read().raw).toEqual(rawA);
  });

  it('keeps source A approval and its audit through same-source refresh and reopen', async () => {
    const { store, raw } = await approvedA();
    const before = store.read(), refreshed = { ...raw, fetchedAt: now().toISOString() };
    const service = createSyncService({ store, now, loader: async () => refreshed });
    await service.refresh('synthetic-admin');
    const reopened = await createStore({ directory: store.directory, now });
    const after = reopened.read();
    expect(after.raw).toEqual(refreshed);
    expect(after.mappings).toEqual(before.mappings);
    expect(after.audit).toEqual(expect.arrayContaining(before.audit));
    expect(after.snapshot!.applications[0]!.agentId).toBe('AG_1');
    expect(after.snapshot!.agents.find(agent => agent.id === 'AG_1')!.name).toBe('Source A Agent');
    const app = await appFor(reopened);
    expect((await get(app, '/api/mappings').expect(200)).body.rows).toEqual(before.mappings);
    expect((await get(app, '/api/applications').expect(200)).body.rows[0].agentId).toBe('AG_1');
  });

  it('refuses direct cross-source publication atomically and leaves source A usable after reopen', async () => {
    const { store } = await approvedA();
    const before = store.read(), rawB = workbook(sourceB);
    const revision = store.revision!();
    const historyBefore = (await readdir(path.join(store.directory, 'history'))).sort();
    const inherited = normalizeWorkbook(rawB, { referenceTabs: [], mappings: before.mappings });
    expect(inherited.applications[0]!.agentId).toBe('AG_1');
    await expect(store.publish(rawB, inherited)).rejects.toMatchObject({ status: 503, code: 'MAPPING_SOURCE_MISMATCH' });
    expect(store.read()).toEqual(before);
    expect(store.revision!()).toBe(revision);
    expect((await readdir(path.join(store.directory, 'history'))).sort()).toEqual(historyBefore);
    const reopened = await createStore({ directory: store.directory, now });
    expect(reopened.read()).toEqual(before);
    const appB = await appFor(reopened, sourceB);
    const rejected = await get(appB, '/api/mappings').expect(503);
    expect(rejected.body).not.toHaveProperty('rows');
    await request(appB).post('/api/mappings').set('Authorization', 'Bearer admin').send({ kind: 'agent', alias: 'Legacy alias', targetId: 'AG_1', reason: 'Synthetic B must not inherit A', snapshotId: before.snapshot!.id }).expect(503);
    expect(reopened.read()).toEqual(before);
    const appA = await appFor(reopened);
    expect((await get(appA, '/api/mappings').expect(200)).body.rows).toEqual(before.mappings);
    expect((await get(appA, '/api/applications').expect(200)).body.rows[0].agentId).toBe('AG_1');
  });

  it('preserves the boundary and A decisions across backup, restore, reopen, then return to A', async () => {
    const { store, raw } = await approvedA();
    const original = store.read();
    const backup = path.join(store.directory, 'synthetic-backup.json');
    await store.backup(backup);
    const target = await privateStore();
    await target.restore(backup);
    const reopened = await createStore({ directory: target.directory, now });
    expect(reopened.read().mappings).toEqual(original.mappings);
    expect(reopened.read().audit).toEqual(expect.arrayContaining(original.audit));
    const syncB = createSyncService({ store: reopened, now, loader: async () => workbook(sourceB) });
    await expect(syncB.refresh()).rejects.toMatchObject({ code: 'MAPPING_SOURCE_MISMATCH' });
    expect(reopened.read().snapshot).toEqual(original.snapshot);
    const appB = await appFor(reopened, sourceB);
    await get(appB, '/api/applications').expect(503);
    await get(appB, '/api/mappings').expect(503);
    const syncA = createSyncService({ store: reopened, now, loader: async () => ({ ...raw, fetchedAt: now().toISOString() }) });
    await syncA.refresh();
    const appA = await appFor(reopened);
    expect((await get(appA, '/api/applications').expect(200)).body.rows[0].agentId).toBe('AG_1');
    expect((await get(appA, '/api/mappings').expect(200)).body.rows).toEqual(original.mappings);
    expect(reopened.read().audit).toEqual(expect.arrayContaining(original.audit));
    expect(reopened.read().audit.some(event => event.action === 'backup.restore')).toBe(true);
  });

  it.each([
    ['source mode', sourceA, 'fixture'],
    ['spreadsheet ID case', sourceA.toLowerCase(), 'google-sheets'],
    ['literal whitespace', ' ' + sourceA, 'google-sheets'],
  ] as const)('treats a different %s as another mapping source', async (_label, id, mode) => {
    const { store } = await approvedA();
    const before = store.read(), other = workbook(id, mode);
    await expect(store.publish(other, normalizeWorkbook(other, { referenceTabs: [], mappings: before.mappings }))).rejects.toMatchObject({ code: 'MAPPING_SOURCE_MISMATCH' });
    const sync = createSyncService({ store, now, allowFixtureForTests: true, loader: async () => other });
    await expect(sync.refresh()).rejects.toMatchObject({ code: 'MAPPING_SOURCE_MISMATCH' });
    expect(store.read().raw).toEqual(before.raw);
    expect(store.read().snapshot).toEqual(before.snapshot);
    expect(store.read().mappings).toEqual(before.mappings);
  });

  it('keeps B unresolved in a separate store and requires a new explicit B approval', async () => {
    const { store: storeA } = await approvedA();
    const beforeA = storeA.read();
    const storeB = await privateStore(), rawB = workbook(sourceB);
    await createSyncService({ store: storeB, now, loader: async () => rawB }).refresh();
    const appB = await appFor(storeB, sourceB);
    expect((await get(appB, '/api/mappings').expect(200)).body.rows).toEqual([]);
    expect((await get(appB, '/api/applications').expect(200)).body.rows[0].agentId).toBeNull();
    await request(appB).post('/api/mappings').set('Authorization', 'Bearer admin').send({ kind: 'agent', alias: 'Legacy alias', targetId: 'AG_1', reason: 'New explicit synthetic B review', snapshotId: storeB.read().snapshot!.id }).expect(201);
    expect(storeB.read().snapshot!.agents.find(agent => agent.id === 'AG_1')!.name).toBe('Different Source B Agent');
    expect(storeB.read().snapshot!.applications[0]!.agentId).toBe('AG_1');
    expect(storeB.read().mappings[0]!.id).not.toBe(beforeA.mappings[0]!.id);
    expect(storeA.read()).toEqual(beforeA);
  });

  it('does not lock an unmapped store to its first source', async () => {
    const store = await privateStore();
    for (const id of [sourceA, sourceB]) {
      const raw = workbook(id);
      await createSyncService({ store, now, loader: async () => raw }).refresh();
    }
    expect(store.read().raw!.spreadsheetId).toBe(sourceB);
    expect(store.read().mappings).toEqual([]);
    expect(store.read().snapshot!.applications[0]!.agentId).toBeNull();
  });

  it('does not rebind unknown-source legacy decisions on sync or backup restoration', async () => {
    const { store } = await approvedA();
    await store.update(state => { state.raw = null; state.snapshot = null; });
    const before = store.read(), backup = path.join(store.directory, 'unknown-source-backup.json');
    await store.backup(backup);
    const target = await privateStore();
    await target.restore(backup);
    const reopened = await createStore({ directory: target.directory, now });
    for (const id of [sourceA, sourceB]) {
      const sync = createSyncService({ store: reopened, now, loader: async () => workbook(id) });
      await expect(sync.refresh()).rejects.toMatchObject({ code: 'MAPPING_SOURCE_MISMATCH' });
      const app = await appFor(reopened, id);
      await get(app, '/api/mappings').expect(503);
    }
    expect(reopened.read().raw).toBeNull();
    expect(reopened.read().snapshot).toBeNull();
    expect(reopened.read().mappings).toEqual(before.mappings);
    expect(reopened.read().audit).toEqual(expect.arrayContaining(before.audit));
  });

  it('does not expose legacy mappings as active when their persisted source is unknown', async () => {
    const { store } = await approvedA();
    await store.update(state => { state.raw = null; state.snapshot = null; });
    const before = store.read();
    const reopened = await createStore({ directory: store.directory, now });
    const appB = await appFor(reopened, sourceB);
    const response = await get(appB, '/api/mappings').expect(503);
    expect(response.body.error.code).toBe('MAPPING_SOURCE_MISMATCH');
    expect(response.body).not.toHaveProperty('rows');
    const rawB = workbook(sourceB);
    await expect(reopened.publish(rawB, normalizeWorkbook(rawB, { referenceTabs: [], mappings: before.mappings }))).rejects.toMatchObject({ code: 'MAPPING_SOURCE_MISMATCH' });
    expect(reopened.read()).toEqual(before);
  });
  it('refuses source B sync instead of applying source A approval to a different AG_1 master', async () => {
    const { store } = await approvedA();
    const before = store.read(), rawB = workbook(sourceB);
    expect(normalizeWorkbook(rawB, { referenceTabs: [], mappings: [] }).applications[0]!.agentId).toBeNull();
    const appB = await appFor(store, sourceB);
    await get(appB, '/api/applications').expect(503);
    const sync = createSyncService({ store, now, loader: async () => rawB });
    await expect(sync.refresh('synthetic-admin')).rejects.toMatchObject({ status: 503, code: 'MAPPING_SOURCE_MISMATCH' });
    const after = store.read();
    expect(after.raw).toEqual(before.raw);
    expect(after.snapshot).toEqual(before.snapshot);
    expect(after.mappings).toEqual(before.mappings);
    expect(after.audit).toEqual(expect.arrayContaining(before.audit));
    expect(after.sync).toMatchObject({ state: 'failed', message: expect.stringMatching(/penyimpanan privat terpisah/i) });
    expect(after.audit.at(-1)).toMatchObject({ action: 'sync.refresh', result: 'failed', details: { code: 'MAPPING_SOURCE_MISMATCH' } });
    await get(appB, '/api/applications').expect(503);
    await get(appB, '/api/mappings').expect(503);
  });
});
