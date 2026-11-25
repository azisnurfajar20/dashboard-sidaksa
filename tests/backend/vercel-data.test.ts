import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { syntheticWorkbook } from '../domain/fixture.js';
import { readConfig } from '../../server/config.js';
import { ApiError } from '../../server/auth.js';

const id = 'HOSTED_SHEETS_SYNTHETIC';
const raw = { ...syntheticWorkbook(), source: 'google-sheets' as const, spreadsheetId: id, fetchedAt: '2026-11-25T00:00:00.000Z' };
const frontend = 'https://sidaksa.example.invalid';
const config = { ...readConfig({ APP_ORIGIN: frontend, GOOGLE_SPREADSHEET_ID: id }), sheetsConfigured: true };
const now = () => new Date('2026-11-25T00:00:00.000Z');

async function hostedModules() {
  const hosted = new URL('../../server/vercel-data.ts', import.meta.url).href;
  const storage = new URL('../../server/vercel-store.ts', import.meta.url).href;
  return { hosted: await import(/* @vite-ignore */ hosted), storage: await import(/* @vite-ignore */ storage) };
}
function fixtureBlob() {
  let seq = 0;
  const objects = new Map<string, { value: string; etag: string; uploadedAt: Date }>();
  const blob = {
    read: vi.fn(async (key: string) => objects.get(key) ?? null),
    write: vi.fn(async (key: string, value: string, expected: string | null) => {
      if ((objects.get(key)?.etag ?? null) !== expected) return null;
      const etag = `v${++seq}`;
      objects.set(key, { value, etag, uploadedAt: now() });
      return etag;
    }),
    prune: vi.fn(async () => {}),
  };
  return { blob, objects };
}
function http(api: Parameters<typeof request>[0]) { return request(api); }
const signed = (token: string) => ['Authorization', `Bearer ${token}`] as const;
const auth = { authenticate: async (token: string) => {
  if (token !== 'admin' && token !== 'leader') throw new ApiError(401, 'INVALID_TOKEN', 'Sesi tidak valid.');
  return { id: `fixture-${token}`, email: 'fixture@example.invalid', role: token as 'admin' | 'leader' };
} };

describe('SIDAKSA on Vercel without a separate server', () => {
  it('uses linked OIDC storage and keeps production credentials out of preview', async () => {
    const { storage } = await hostedModules();
    const env = { BLOB_STORE_ID: 'fixture-production', BLOB_READ_WRITE_TOKEN: 'legacy-fixture' };
    expect(storage.privateBlobCredentials(env, false)).toEqual({ storeId: 'fixture-production' });
    expect(storage.privateBlobCredentials(env, true)).toBeNull();
    expect(storage.privateBlobCredentials({ ...env, SIDAKSA_PREVIEW_BLOB_STORE_ID: 'fixture-preview' }, true)).toEqual({ storeId: 'fixture-preview' });
    expect(storage.privateBlobCredentials({ BLOB_READ_WRITE_TOKEN: 'legacy-fixture' }, false)).toEqual({ token: 'legacy-fixture' });
    await expect(storage.createPrivateBlob(null).read('fixture')).rejects.toMatchObject({ code: 'STORE_UNAVAILABLE' });
  });
  it('preserves settings and a Google snapshot across cold starts; keeps data behind Supabase roles', async () => {
    const { hosted } = await hostedModules(); const { blob } = fixtureBlob();
    const loader = vi.fn(async () => raw);
    const create = () => hosted.createVercelDataHandler({ ...auth, config, blob, loader, now });
    const api = http(await create());
    await api.get('/api/health').expect(200, {status:'ok'});
    await api.get('/api/overview').expect(401);
    expect(blob.read).not.toHaveBeenCalled();
    await api.get('/api/settings').set(...signed('leader')).expect(403);
    expect(loader).not.toHaveBeenCalled();
    const setup = await api.get('/api/settings').set(...signed('admin')).expect(200);
    expect(setup.body.sheetsConfigured).toBe(true);
    await api.put('/api/settings').set('Origin', 'https://untrusted.invalid').set(...signed('admin')).send({ referenceTabs: [], syncIntervalMinutes: 25, retentionDays: 30 }).expect(403);
    await api.put('/api/settings').set('Origin', frontend).set(...signed('admin')).send({ referenceTabs: [], syncIntervalMinutes: 25, retentionDays: 30 }).expect(200);
    const sync = await api.post('/api/sync').set('Origin', frontend).set(...signed('admin')).send({}).expect(200);
    expect(sync.body.snapshot.source).toBe('google-sheets');
    const otherInstance = http(await create());
    await otherInstance.get('/api/settings').set(...signed('admin')).expect(200).expect(r => expect(r.body.syncIntervalMinutes).toBe(25));
    const status = await otherInstance.get('/api/status').set(...signed('leader')).expect('Cache-Control', 'private, no-store').expect(200);
    expect(status.body.snapshot.id).toBe(sync.body.snapshot.id);
    await otherInstance.get(`/api/overview?snapshotId=${sync.body.snapshot.id}`).set(...signed('leader')).expect(200);
    await otherInstance.get('/api/candidates?limit=1').set(...signed('leader')).expect(200).expect(r => expect(r.body.rows[0]).not.toHaveProperty('phone'));
    await otherInstance.get('/api/overview?snapshotId=stale').set(...signed('leader')).expect(409);
    await otherInstance.get('/api/departures').set(...signed('leader')).expect(503);
    expect(loader).toHaveBeenCalledOnce();
    await otherInstance.get('/api/audit').set(...signed('admin')).expect(200).expect(r => expect(r.body.rows.map((x: { action: string }) => x.action)).toContain('snapshot.publish'));
  });

  it('preserves the prior snapshot when an upstream read fails, including from another instance', async () => {
    const { hosted } = await hostedModules(); const { blob } = fixtureBlob();
    const loader = vi.fn<() => Promise<typeof raw>>().mockResolvedValueOnce(raw).mockRejectedValueOnce(new Error('fixture-private-text'));
    const create = () => hosted.createVercelDataHandler({ ...auth, config, blob, loader, now });
    const initial = await http(await create()).post('/api/sync').set(...signed('admin')).send({}).expect(200);
    const failed = await http(await create()).post('/api/sync').set(...signed('admin')).send({}).expect(503);
    expect(failed.text).not.toContain('fixture-private-text');
    const status = await http(await create()).get('/api/status').set(...signed('admin')).expect(200);
    expect(status.body.snapshot.id).toBe(initial.body.snapshot.id);
    expect(status.body.sync.state).toBe('failed');
  });

  it('rejects competing writes rather than replacing a committed settings update', async () => {
    const { storage } = await hostedModules(); const { blob } = fixtureBlob();
    const a = await storage.openVercelStore({ blob, config, now });
    const b = await storage.openVercelStore({ blob, config, now });
    await a.update((s: {settings:{retentionDays:number}}) => { s.settings.retentionDays = 60; });
    await expect(b.update((s: {settings:{retentionDays:number}}) => { s.settings.retentionDays = 1; })).rejects.toMatchObject({ code: 'STORE_CONFLICT' });
    const c = await storage.openVercelStore({ blob, config, now });
    expect(c.read().settings.retentionDays).toBe(60);
  });

  it('blocks overlapping refreshes and recovers a timed-out sync without replacing the new snapshot', async () => {
    const { hosted } = await hostedModules(); const { blob } = fixtureBlob();
    let time = now().getTime();
    let started!: () => void, release!: () => void;
    const entered = new Promise<void>(resolve => { started = resolve; });
    const hold = new Promise<void>(resolve => { release = resolve; });
    const loader = vi.fn(async () => { started(); await hold; return raw; });
    const create = (source: () => Promise<typeof raw>) => hosted.createVercelDataHandler({ ...auth, config, blob, loader: source, now: () => new Date(time) });
    const api = http(await create(loader));
    const first = api.post('/api/sync').set(...signed('admin')).send({}).then(response => response);
    const replacement = vi.fn(async () => ({ ...raw, fetchedAt: new Date(time).toISOString() }));
    const other = http(await create(replacement));
    try {
      await Promise.race([entered, first.then(r => { throw new Error(`First sync returned ${r.status} before loading`); })]);
      await other.post('/api/sync').set(...signed('admin')).send({}).expect(409);
      expect(replacement).not.toHaveBeenCalled();
      time += 91_000;
      await other.get('/api/status').set(...signed('admin')).expect(200).expect(r => expect(r.body.sync.state).toBe('failed'));
      const second = await other.post('/api/sync').set(...signed('admin')).send({}).expect(200);
      release();
      expect((await first).status).toBe(409);
      await other.get('/api/status').set(...signed('admin')).expect(200).expect(r => expect(r.body.snapshot.id).toBe(second.body.snapshot.id));
    } finally { release(); await first; }
  });

  it('requires scheduler authorization and applies the minimum refresh interval', async () => {
    const { hosted } = await hostedModules(); const { blob } = fixtureBlob();
    const loader = vi.fn(async () => raw);
    const api = http(await hosted.createVercelDataHandler({ ...auth, config, blob, loader, now, cronSecret: 'synthetic-cron-authorization' }));
    await api.get('/api/sidaksa-data?__sidaksa_route=3').expect(401);
    await api.get('/api/sidaksa-cron').set(...signed('admin')).expect(401);
    await api.post('/api/sidaksa-cron').set('Authorization', 'Bearer synthetic-cron-authorization').expect(404);
    expect(blob.read).not.toHaveBeenCalled();
    await api.get('/api/sidaksa-cron').set('Authorization', 'Bearer synthetic-cron-authorization').expect(204);
    await api.get('/api/sidaksa-cron').set('Authorization', 'Bearer synthetic-cron-authorization').expect(204);
    expect(loader).toHaveBeenCalledOnce();
    await api.get('/api/sidaksa-data?__sidaksa_route=3').set(...signed('leader')).expect(200);
  });
});
