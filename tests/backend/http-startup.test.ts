import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import request from 'supertest';
import { startServer, type RunningServer } from '../../server/index';
import { readConfig } from '../../server/config';
import { runCli } from '../../server/cli';
import { createStore } from '../../server/store';
import { normalizeWorkbook } from '../../server/domain/normalize';
import { syntheticWorkbook } from '../domain/fixture';

const directories: string[] = [], servers: RunningServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map(s => s.close()));
  await Promise.all(directories.splice(0).map(d => rm(d, { recursive: true, force: true })));
});
async function isolated() {
  await mkdir('.private/test-tmp', { recursive: true });
  const root = await mkdtemp(path.resolve('.private/test-tmp/startup-')); directories.push(root);
  await mkdir(path.join(root, 'dist/client/assets'), { recursive: true });
  await mkdir(path.join(root, '.private'), { recursive: true });
  await writeFile(path.join(root, 'dist/client/index.html'), '<!doctype html><html><title>isolated startup test</title><div id="root">SIDAKSA TEST BUILD</div></html>');
  await writeFile(path.join(root, 'dist/client/assets/app.js'), 'console.log("isolated public asset");');
  await writeFile(path.join(root, '.private/never-public.json'), 'TEST PRIVATE CONTENT');
  await writeFile(path.join(root, '.env'), 'TEST_SECRET=NEVER_PUBLIC');
  const config = { ...readConfig({ SIDAKSA_DATA_DIR: path.join(root, '.private/data'), APP_ORIGIN: 'http://127.0.0.1:3080' }), port: 0 };
  return { root, config };
}
describe('real listener and production static boundary', () => {
  it('still closes its listener if scheduler shutdown fails', async () => {
    const { root, config } = await isolated();
    const running = await startServer({ config, projectRoot: root }); servers.push(running); await running.ready;
    const originalStop = running.app.locals.sidaksa.sync.stop.bind(running.app.locals.sidaksa.sync);
    vi.spyOn(running.app.locals.sidaksa.sync, 'stop').mockImplementation(async () => { await originalStop(); throw new Error('synthetic shutdown failure'); });
    try {
      await expect(running.close()).rejects.toThrow('synthetic shutdown failure');
      expect(running.server.listening).toBe(false);
    } finally {
      if (running.server.listening) await new Promise<void>(resolve => running.server.close(() => resolve()));
      servers.splice(servers.indexOf(running), 1);
    }
  });
  it('rejects build symlinks or junctions that could expose files outside dist/client', async () => {
    const { root, config } = await isolated();
    await symlink(path.join(root, '.private'), path.join(root, 'dist/client/linked-private'), process.platform === 'win32' ? 'junction' : 'dir');
    let running: RunningServer | undefined;
    try { running = await startServer({ config, projectRoot: root }); servers.push(running); } catch { /* linked public build is unsafe */ }
    expect(running === undefined).toBe(true);
  });
  it('refuses a private store configured inside frontend-public directories', async () => {
    const { root, config } = await isolated();
    let running: RunningServer | undefined;
    try { running = await startServer({ config: { ...config, dataDir: path.join(root, 'dist/client/private-data') }, projectRoot: root }); servers.push(running); } catch { /* unsafe layout must fail closed */ }
    expect(running === undefined).toBe(true);
  });
  it('refuses restore and a second writer while the same private store has a running server', async () => {
    const { root, config } = await isolated();
    const running = await startServer({ config, projectRoot: root }); servers.push(running); await running.ready;
    const backup = path.join(root, '.private/backups/live-boundary.json');
    const options = { env: { SIDAKSA_DATA_DIR: config.dataDir }, projectRoot: root, write: (_line: string) => {} };
    expect(await runCli(['backup', backup], options)).toBe(0);
    expect(await runCli(['restore', backup], options)).toBe(1);
    let duplicate: RunningServer | undefined;
    try { duplicate = await startServer({ config, projectRoot: root }); servers.push(duplicate); } catch { /* expected store lock */ }
    expect(duplicate).toBeUndefined();
    await running.close(); servers.splice(servers.indexOf(running), 1);
    expect(await runCli(['restore', backup], options)).toBe(0);
  });
  it('writes and restores real private backups while refusing fixture restoration through the production CLI', async () => {
    const { root, config } = await isolated();
    const source = await createStore({ directory: config.dataDir });
    const raw = syntheticWorkbook(); await source.publish(raw, normalizeWorkbook(raw, { referenceTabs: [], mappings: [] }));
    const backup = path.join(root, '.private/backups/test.json'), output: string[] = [];
    const options = { projectRoot: root, env: { SIDAKSA_DATA_DIR: config.dataDir }, write: (line: string) => output.push(line) };
    expect(await runCli(['backup', backup], options)).toBe(0);
    expect(JSON.parse(await readFile(backup, 'utf8')).state.snapshot.id).toBe(source.read().snapshot!.id);
    expect(output.join('')).not.toMatch(/081-PRIVATE|Test Person|private candidate notes/);
    const target = path.join(root, '.private/restored');
    const restoreOptions = { ...options, env: { SIDAKSA_DATA_DIR: target } };
    expect(await runCli(['restore', backup], restoreOptions)).toBe(1);
    expect((await createStore({ directory: target })).read().snapshot).toBeNull();
    expect(await runCli(['restore', backup], { ...restoreOptions, allowFixtureForTests: true })).toBe(0);
    expect((await createStore({ directory: target })).read().snapshot).toEqual(source.read().snapshot);
    await writeFile(path.join(root, '.private/backups/bad.json'), '{"format":"sidaksa-private-backup","version":1,"state":{}}');
    expect(await runCli(['restore', path.join(root, '.private/backups/bad.json')], restoreOptions)).toBe(1);
    expect((await createStore({ directory: target })).read().snapshot!.id).toBe(source.read().snapshot!.id);
    await writeFile(path.join(target, 'state.json'), 'corrupted local cache');
    expect(await runCli(['restore', backup], { ...restoreOptions, allowFixtureForTests: true })).toBe(0);
    expect((await createStore({ directory: target })).read().snapshot!.id).toBe(source.read().snapshot!.id);
    expect(await runCli(['backup', path.join(root, 'dist/client/exposed.json')], options)).toBe(1);
    expect(await runCli(['backup', path.join(config.dataDir, 'state.json')], options)).toBe(1);
  });
  it('reports missing configuration honestly in the CLI without leaking values or creating runtime data', async () => {
    const { root, config } = await isolated();
    const output: string[] = [];
    const code = await runCli(['check'], { env: { SIDAKSA_DATA_DIR: config.dataDir }, projectRoot: root, write: line => output.push(line) });
    expect(code).toBe(2);
    expect(JSON.parse(output[0]!)).toMatchObject({ check: 'configuration-only', configured: false, authConfigured: false, sheetsConfigured: false });
    const invalid: string[] = [];
    expect(await runCli(['check'], { env: { PORT: 'SECRET-BAD-PORT' }, write: line => invalid.push(line) })).toBe(1);
    expect(invalid.join('')).not.toContain('SECRET-BAD-PORT');
    expect(await runCli(['unknown'], { env: {}, write: () => {} })).toBe(1);
  });
  it('runs real Vite middleware on the API listener without exposing backend or private files', async () => {
    const { root, config } = await isolated();
    await mkdir(path.join(root, 'web'), { recursive: true });
    await writeFile(path.join(root, 'index.html'), '<!doctype html><html><div id="root"></div><script type="module" src="/web/entry.ts"></script></html>');
    await writeFile(path.join(root, 'vite.config.ts'), 'export default {server:{fs:{deny:["**/denied-control.txt"]}}};');
    await writeFile(path.join(root, 'web/denied-control.txt'), 'TEST DENIED CONTROL CONTENT');
    await writeFile(path.join(root, 'web/entry.ts'), 'const label: string = "REAL VITE TRANSFORM"; document.querySelector("#root")!.textContent = label;');
    const running = await startServer({ config, projectRoot: root, development: true }); servers.push(running);
    await running.ready;
    const html = await request(running.server).get('/').set('Accept', 'text/html').expect(200);
    expect(html.text).toContain('/@vite/client');
    const module = await request(running.server).get('/web/entry.ts').expect(200);
    expect(module.text).toContain('REAL VITE TRANSFORM'); expect(module.text).not.toContain('label: string');
    await request(running.server).get('/@vite/client').expect(200);
    await request(running.server).get('/api/public-config').expect(200);
    const deniedByRootConfig = await request(running.server).get('/web/denied-control.txt').expect(403);
    expect(deniedByRootConfig.text.includes('TEST DENIED CONTROL CONTENT')).toBe(false);
    for (const url of ['/.env', '/.private/never-public.json', '/server/app.ts', '/docs/PRD.md', '/@fs/D:/sidaksa/.env', '/web/%2e%2e/.env']) {
      const denied = await request(running.server).get(url).expect(404);
      expect(denied.text).not.toMatch(/TEST PRIVATE CONTENT|NEVER_PUBLIC/);
      await request(running.server).head(url).expect(404);
    }
  });
  it('binds an isolated listener, serves only dist/client and closes its scheduler cleanly', async () => {
    const { root, config } = await isolated();
    const running = await startServer({ config, projectRoot: root }); servers.push(running);
    await running.ready;
    const health = await fetch(running.url + '/api/health'); expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: 'ok' });
    const spa = await request(running.server).get('/applications').set('Accept', 'text/html').expect(200);
    expect(spa.text).toContain('SIDAKSA TEST BUILD');
    await request(running.server).get('/assets/app.js').expect(200);
    for (const url of ['/.env', '/.private/never-public.json', '/server/app.ts', '/docs/PRD.md', '/@fs/D:/sidaksa/.private/fixtures/source.json', '/%2eprivate/never-public.json', '/%252eprivate/never-public.json', '/%2Eenv', '/.%70rivate/never-public.json']) {
      const denied = await request(running.server).get(url).set('Accept', 'text/html').expect(404);
      expect(denied.text).not.toMatch(/TEST PRIVATE CONTENT|NEVER_PUBLIC|SIDAKSA TEST BUILD/);
      await request(running.server).head(url).expect(404);
    }
    await request(running.server).get('/api/applications').expect(401);
    expect(running.app.locals.sidaksa.store.read().sync.state).toBe('failed');
    expect(running.app.locals.sidaksa.store.read().sync.nextRunAt).toEqual(expect.any(String));
    await running.close(); servers.splice(servers.indexOf(running), 1);
    expect(running.app.locals.sidaksa.store.read().sync.nextRunAt).toBeNull();
    await expect(fetch(running.url + '/api/health')).rejects.toThrow();
  });
});
