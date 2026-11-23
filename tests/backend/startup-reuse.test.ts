import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import * as runtime from '../../server/index';
import { readConfig } from '../../server/config';
import type { RunningServer, StartOptions } from '../../server/index';

const directories: string[] = [], servers: RunningServer[] = [];
const otherServers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => server.close()));
  await Promise.all(otherServers.splice(0).map(server => new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); })));
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});
async function isolated() {
  await mkdir('.private/test-tmp', { recursive: true });
  const root = await mkdtemp(path.resolve('.private/test-tmp/startup-reuse-')); directories.push(root);
  await mkdir(path.join(root, 'dist/client'), { recursive: true });
  await writeFile(path.join(root, 'dist/client/index.html'), '<html><div id="root">ISOLATED STARTUP</div></html>');
  const config = { ...readConfig({ SIDAKSA_DATA_DIR: path.join(root, '.private/data') }), port: 0 };
  return { root, config };
}
function startOrReuse() {
  const implementation = Reflect.get(runtime, 'startOrReuseServer');
  expect(implementation, 'CLI must distinguish an existing matching instance from a startup failure').toBeTypeOf('function');
  return implementation as (options: StartOptions) => Promise<{ alreadyRunning: boolean; url: string; running?: RunningServer }>;
}

describe('safe repeated SIDAKSA startup', () => {
  it('gives a specific, secret-safe explanation for locked storage and an occupied port', () => {
    const explain = Reflect.get(runtime, 'startupErrorMessage');
    expect(explain).toBeTypeOf('function');
    expect(explain({ code: 'STORE_LOCKED', message: 'SECRET-SENTINEL' })).toContain('Penyimpanan privat');
    expect(explain({ code: 'EADDRINUSE', message: 'SECRET-SENTINEL' })).toContain('Port');
    for (const code of ['STORE_LOCKED', 'EADDRINUSE', 'UNKNOWN']) expect(explain({ code, message: 'SECRET-SENTINEL' })).not.toContain('SECRET-SENTINEL');
  });
  it('starts a new server normally when no instance owns the store', async () => {
    const { root, config } = await isolated();
    const result = await startOrReuse()({ config, projectRoot: root });
    if (result.running) servers.push(result.running);
    expect(result.alreadyRunning).toBe(false);
    expect(result.running).toBeDefined();
    await result.running!.ready;
    const health = await fetch(result.url + '/api/health');
    const lock = JSON.parse(await readFile(path.join(config.dataDir, '.runtime.lock'), 'utf8'));
    expect(health.headers.get('X-Sidaksa-Instance')).toBe(lock.instanceId);
    expect(await health.json()).toEqual({ status: 'ok' });
  });
  it('reuses a verified active instance without changing its lock or state or starting another writer', async () => {
    const { root, config } = await isolated();
    const original = await runtime.startServer({ config, projectRoot: root }); servers.push(original); await original.ready;
    const lockPath = path.join(config.dataDir, '.runtime.lock'), statePath = path.join(config.dataDir, 'state.json');
    const beforeLock = await readFile(lockPath, 'utf8'), beforeState = await readFile(statePath, 'utf8');
    const result = await startOrReuse()({ config: { ...config, port: Number(new URL(original.url).port) }, projectRoot: root });
    if (result.running) servers.push(result.running);
    expect(result).toMatchObject({ alreadyRunning: true, url: original.url });
    expect(result.running).toBeUndefined();
    expect(await readFile(lockPath, 'utf8')).toBe(beforeLock);
    expect(await readFile(statePath, 'utf8')).toBe(beforeState);
    expect((await fetch(original.url + '/api/health')).status).toBe(200);
    expect((await fetch(original.url + '/api/overview')).status).toBe(401);
  });
  it('does not treat another healthy service on the configured port as this project instance', async () => {
    const { root, config } = await isolated();
    await mkdir(config.dataDir, { recursive: true });
    const lockPath = path.join(config.dataDir, '.runtime.lock');
    const lock = JSON.stringify({ pid: process.pid, kind: 'sidaksa-private-writer', instanceId: randomUUID(), mode: 'production' });
    await writeFile(lockPath, lock);
    const foreign = createServer((_req, res) => { res.setHeader('X-Sidaksa-Instance', randomUUID()); res.end(JSON.stringify({ status: 'ok' })); });
    otherServers.push(foreign);
    await new Promise<void>(resolve => foreign.listen(0, '127.0.0.1', resolve));
    const port = (foreign.address() as { port: number }).port;
    await expect(startOrReuse()({ config: { ...config, port }, projectRoot: root })).rejects.toMatchObject({ code: 'STORE_LOCKED' });
    expect(await readFile(lockPath, 'utf8')).toBe(lock);
    expect(foreign.listening).toBe(true);
  });
  it('keeps legacy, malformed and mode-mismatched locks fail-closed instead of deleting them', async () => {
    const { root, config } = await isolated();
    await mkdir(config.dataDir, { recursive: true });
    const lockPath = path.join(config.dataDir, '.runtime.lock');
    for (const lock of ['{broken', JSON.stringify({ pid: process.pid, kind: 'sidaksa-private-writer' }), JSON.stringify({ pid: process.pid, kind: 'sidaksa-private-writer', instanceId: randomUUID(), mode: 'development' })]) {
      await writeFile(lockPath, lock);
      await expect(startOrReuse()({ config, projectRoot: root })).rejects.toMatchObject({ code: 'STORE_LOCKED' });
      expect(await readFile(lockPath, 'utf8')).toBe(lock);
    }
  });
  it('reports a real port conflict without deleting another service or retaining a newly acquired lock', async () => {
    const { root, config } = await isolated();
    const foreign = createServer((_req, res) => res.end('not SIDAKSA')); otherServers.push(foreign);
    await new Promise<void>(resolve => foreign.listen(0, '127.0.0.1', resolve));
    const port = (foreign.address() as { port: number }).port;
    await expect(startOrReuse()({ config: { ...config, port }, projectRoot: root })).rejects.toMatchObject({ code: 'EADDRINUSE' });
    await expect(readFile(path.join(config.dataDir, '.runtime.lock'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(foreign.listening).toBe(true);
  });
});
