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

describe('revision-bound private snapshot reads', () => {
  it('reuses unchanged reads, invalidates on a committed publication and applies role projection per request', async () => {
    await mkdir('.private/test-tmp', { recursive: true });
    const directory = await mkdtemp(path.resolve('.private/test-tmp/read-cache-')); directories.push(directory);
    const store = await createStore({ directory });
    const raw = syntheticWorkbook();
    await store.publish(raw, normalizeWorkbook(raw, { referenceTabs: [], mappings: [] }));
    const app = await createApp({ config: readConfig({ SIDAKSA_DATA_DIR: directory }), store, allowFixtureForTests: true,
      authenticator: async token => ({ id: token, email: 'fixture@sidaksa.invalid', role: token === 'leader' ? 'leader' : 'recruiter' }) });
    const read = vi.spyOn(store, 'read');
    const get = (url: string, role = 'recruiter') => request(app).get(url).set('Authorization', `Bearer ${role}`);
    const first = await get('/api/overview').expect(200);
    read.mockClear();
    await get('/api/overview').expect(200);
    expect(read).not.toHaveBeenCalled();
    const recruiter = await get('/api/candidates').expect(200);
    expect(recruiter.body.rows[0].phone).toBe('081-PRIVATE');
    const leader = await get('/api/candidates', 'leader').expect(200);
    expect(leader.body.rows[0]).not.toHaveProperty('phone');
    expect((await get('/api/candidates').expect(200)).body.rows[0].phone).toBe('081-PRIVATE');
    const next = structuredClone(raw), tab = next.sheets.find(sheet => sheet.name === 'Proses Rekrutment')!;
    tab.rows.push({ ...structuredClone(tab.rows[1]!), rowNumber: 3 });
    await store.publish(next, normalizeWorkbook(next, { referenceTabs: [], mappings: [] }));
    const updated = await get('/api/overview').expect(200);
    expect(updated.body.meta.snapshotId).not.toBe(first.body.meta.snapshotId);
    expect(updated.body.metrics.find((metric: { key: string }) => metric.key === 'applications').value).toBe(2);
    await store.update(state => { state.raw = null; state.snapshot = null; });
    await get('/api/overview').expect(503);
    await store.publish(raw, normalizeWorkbook(raw, { referenceTabs: [], mappings: [] }));
    expect((await get('/api/overview').expect(200)).body.metrics.find((metric: { key: string }) => metric.key === 'applications').value).toBe(1);
  });
});
