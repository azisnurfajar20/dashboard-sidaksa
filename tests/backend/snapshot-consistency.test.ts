import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { createApp } from '../../server/app';
import { readConfig } from '../../server/config';
import { createStore } from '../../server/store';
import { normalizeWorkbook } from '../../server/domain/normalize';
import { syntheticWorkbook } from '../domain/fixture';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))); });
async function setup() {
  await mkdir('.private/test-tmp', { recursive: true });
  const directory = await mkdtemp(path.resolve('.private/test-tmp/snapshot-binding-')); directories.push(directory);
  const references = ['Crew List Departure', 'Funnel Rekap'];
  const store = await createStore({ directory, settings: { referenceTabs: references } });
  const raw = syntheticWorkbook();
  await store.publish(raw, normalizeWorkbook(raw, { referenceTabs: references, mappings: [] }));
  const app = await createApp({ config: readConfig({ SIDAKSA_DATA_DIR: directory }), store, allowFixtureForTests: true,
    authenticator: async token => ({ id: token, email: 'fixture@sidaksa.invalid', role: token === 'leader' ? 'leader' : token === 'admin' ? 'admin' : 'recruiter' }) });
  const get = (url: string, role = 'admin') => request(app).get(url).set('Authorization', `Bearer ${role}`);
  return { store, raw, references, get };
}
describe('AC-12 displayed snapshot read precondition', () => {
  it('rejects every stale bound drilldown/detail/CSV after publication, without exporting or bypassing role/source checks', async () => {
    const { store, raw, references, get } = await setup();
    const first = (await get('/api/overview').expect(200)).body;
    const application = store.read().snapshot!.applications[0]!;
    const next = structuredClone(raw), tab = next.sheets.find(sheet => sheet.name === 'Proses Rekrutment')!;
    tab.rows.push({ ...structuredClone(tab.rows[1]!), rowNumber: 3 });
    await store.publish(next, normalizeWorkbook(next, { referenceTabs: references, mappings: [] }));
    const auditCount = store.read().audit.length;
    const endpoints = ['/api/overview', '/api/applications', `/api/applications/${encodeURIComponent(application.id)}`, '/api/candidates', '/api/candidates/DK_001', '/api/partners?kind=companies', '/api/departures', '/api/issues', '/api/audit', ...['aggregate', 'applications', 'candidates', 'departures', 'partners'].map(kind => `/api/export?kind=${kind}`)];
    for (const endpoint of endpoints) {
      const response = await get(endpoint).query({ snapshotId: first.meta.snapshotId });
      expect(response.status, endpoint).toBe(409);
      expect(response.body).toMatchObject({ error: { code: 'SNAPSHOT_CHANGED' } });
      expect(response.headers['content-disposition']).toBeUndefined();
    }
    expect(store.read().audit.length).toBe(auditCount);
    await get('/api/export?kind=applications', 'leader').query({ snapshotId: first.meta.snapshotId }).expect(403);
    const latest = (await get('/api/overview').expect(200)).body;
    expect(latest.metrics.find((metric: { key: string }) => metric.key === 'applications').value).toBe(2);
    expect(latest.meta.snapshotId).not.toBe(first.meta.snapshotId);
    const read = vi.spyOn(store, 'read'); read.mockClear();
    const matching = await get('/api/applications').query({ snapshotId: latest.meta.snapshotId, from: '2025-01-10', to: '2025-01-20' }).expect(200);
    expect(matching.body.meta).toMatchObject({ snapshotId: latest.meta.snapshotId, filters: { from: '2025-01-10', to: '2025-01-20' }, excludedDatePrecision: 2 });
    expect(matching.body.meta.filters).not.toHaveProperty('snapshotId');
    expect(matching.body.pagination.total).toBe(0);
    expect(read).not.toHaveBeenCalled(); read.mockRestore();
    await store.update(state => { state.raw = null; state.snapshot = null; });
    await get('/api/applications').query({ snapshotId: latest.meta.snapshotId }).expect(503);
  });
  it('validates the optional binding literally while preserving existing latest consumers and month-only cohorts', async () => {
    const { get } = await setup();
    const first = (await get('/api/overview').expect(200)).body;
    const bound = await get('/api/applications').query({ snapshotId: first.meta.snapshotId, from: '2025-01-01', to: '2025-01-31' }).expect(200);
    expect(bound.body.pagination.total).toBe(1);
    expect(bound.body.meta.filters).toEqual({ from: '2025-01-01', to: '2025-01-31' });
    for (const query of ['snapshotId=', 'snapshotId=%20%20', 'snapshotId=a&snapshotId=b', 'snapshotId=%00', `snapshotId=${'x'.repeat(201)}`]) await get('/api/applications?' + query).expect(400);
    await get('/api/applications?snapshotId=unchanged-literal').expect(409);
    const leader = await get('/api/candidates', 'leader').query({ snapshotId: first.meta.snapshotId }).expect(200);
    expect(leader.body.rows[0]).not.toHaveProperty('phone');
    const csv = await get('/api/export?kind=applications').query({ snapshotId: first.meta.snapshotId }).expect(200);
    expect(csv.text).toContain(first.meta.snapshotId);
  });
});
