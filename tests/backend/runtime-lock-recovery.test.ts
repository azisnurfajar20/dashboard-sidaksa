import { afterEach, describe, expect, it, vi } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import childProcess from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { acquireStoreLock } from '../../server/app.js';

const scratch = path.resolve('.private/test-tmp');
const directories: string[] = [];
const children: ChildProcess[] = [];
const releases: Array<() => Promise<void>> = [];
const metadata = { instanceId: randomUUID(), mode: 'production' as const };
const lockPath = (directory: string) => path.join(directory, '.runtime.lock');

afterEach(async () => {
  vi.restoreAllMocks();
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited;
    }
  }
  await Promise.all(releases.splice(0).map(release => release()));
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

async function isolated() {
  await mkdir(scratch, { recursive: true });
  const directory = await mkdtemp(path.join(scratch, 'runtime-recovery-')); directories.push(directory);
  return directory;
}

// Real standalone Node processes: IPC is only a test barrier, never an ownership oracle.
async function contender(directory: string, wait = false) {
  const helper = path.join(directory, `child-${randomUUID()}.mjs`);
  const moduleUrl = pathToFileURL(path.resolve('server/app.ts')).href;
  await writeFile(helper, `
    import { acquireStoreLock } from ${JSON.stringify(moduleUrl)};
    const timer = setInterval(() => {}, 1000);
    async function start() {
      try {
        await acquireStoreLock(${JSON.stringify(directory)}, ${JSON.stringify(metadata)});
        process.send({ status: 'acquired', pid: process.pid });
      } catch (error) {
        process.send({ status: 'refused', code: error.code, message: error.message });
        clearInterval(timer); process.disconnect();
      }
    }
    ${wait ? "process.once('message', start); process.send({ status: 'ready' });" : 'await start();'}
  `);
  const child = spawn(process.execPath, ['--import', 'tsx', helper], {
    cwd: path.resolve('.'), stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: { ...process.env, TMP: scratch, TEMP: scratch, TMPDIR: scratch, TSX_CACHE_DIR: path.join(scratch, 'tsx-cache') },
  });
  children.push(child);
  let stderr = ''; child.stderr!.on('data', chunk => { stderr += chunk; });
  const messages: Array<Record<string, unknown>> = [];
  const waiting: Array<(message: Record<string, unknown>) => void> = [];
  child.on('message', message => {
    const value = message as Record<string, unknown>;
    const resolve = waiting.shift(); if (resolve) resolve(value); else messages.push(value);
  });
  const next = () => new Promise<Record<string, unknown>>((resolve, reject) => {
    if (messages.length) { resolve(messages.shift()!); return; }
    const onExit = (code: number | null) => reject(new Error(`Child exited before its IPC result: ${code}; ${stderr}`));
    child.once('exit', onExit);
    waiting.push(message => { child.off('exit', onExit); resolve(message); });
  });
  return { child, next };
}
async function forceExit(child: ChildProcess) {
  const exited = once(child, 'exit'); expect(child.kill('SIGKILL')).toBe(true); await exited;
  expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
}
async function deadPid(directory: string) {
  const owner = await contender(directory);
  const result = await owner.next(); expect(result.status).toBe('acquired');
  await forceExit(owner.child);
  return result.pid as number;
}

describe('private writer lock recovery', () => {
  it('restarts after a real child writer is forcibly terminated, without deleting store data', async () => {
    const directory = await isolated();
    await writeFile(path.join(directory, 'fixture-state.json'), 'PRIVATE-FIXTURE-UNCHANGED');
    const pid = await deadPid(directory);
    expect(JSON.parse(await readFile(lockPath(directory), 'utf8')).pid).toBe(pid);
    const restarted = await contender(directory);
    expect(await restarted.next()).toMatchObject({ status: 'acquired' });
    expect(await readFile(path.join(directory, 'fixture-state.json'), 'utf8')).toBe('PRIVATE-FIXTURE-UNCHANGED');
  });

  it('refuses a live owner without changing its metadata', async () => {
    const directory = await isolated(); const owner = await contender(directory);
    expect(await owner.next()).toMatchObject({ status: 'acquired' });
    const before = await readFile(lockPath(directory), 'utf8');
    await expect(acquireStoreLock(directory)).rejects.toMatchObject({ code: 'STORE_LOCKED' });
    expect(await readFile(lockPath(directory), 'utf8')).toBe(before);
  });

  it('allows exactly one of two simultaneous child restart contenders to write', async () => {
    const directory = await isolated(); await deadPid(directory);
    const [first, second] = await Promise.all([contender(directory, true), contender(directory, true)]);
    expect(await first.next()).toMatchObject({ status: 'ready' });
    expect(await second.next()).toMatchObject({ status: 'ready' });
    first.child.send('go'); second.child.send('go');
    const outcomes = await Promise.all([first.next(), second.next()]);
    expect(outcomes.filter(result => result.status === 'acquired')).toHaveLength(1);
    expect(outcomes.filter(result => result.status === 'refused' && result.code === 'STORE_LOCKED')).toHaveLength(1);
    const winner = outcomes.find(result => result.status === 'acquired')!;
    expect(JSON.parse(await readFile(lockPath(directory), 'utf8')).pid).toBe(winner.pid);
  });

  it('recovers legacy and runtime-UUID metadata only when the exact PID is absent', async () => {
    const directory = await isolated(); const pid = await deadPid(directory);
    for (const value of [{ pid, kind: 'sidaksa-private-writer' }, { pid, kind: 'sidaksa-private-writer', ...metadata }]) {
      await writeFile(lockPath(directory), JSON.stringify(value));
      const release = await acquireStoreLock(directory); releases.push(release);
      expect(JSON.parse(await readFile(lockPath(directory), 'utf8')).pid).toBe(process.pid);
      await release();
    }
  });

  it('never treats malformed, partial, foreign, invalid-PID or ambiguous metadata as dead', async () => {
    const directory = await isolated();
    const cases = ['', '{broken', 'null', '[]', '{}',
      JSON.stringify({ pid: 0, kind: 'sidaksa-private-writer' }),
      JSON.stringify({ pid: -1, kind: 'sidaksa-private-writer' }),
      JSON.stringify({ pid: '123', kind: 'sidaksa-private-writer' }),
      JSON.stringify({ pid: 1.5, kind: 'sidaksa-private-writer' }),
      JSON.stringify({ pid: 2147483648, kind: 'sidaksa-private-writer' }),
      JSON.stringify({ pid: 123, kind: 'foreign' }),
      JSON.stringify({ pid: 123, kind: 'sidaksa-private-writer', instanceId: randomUUID() }),
      JSON.stringify({ pid: 123, kind: 'sidaksa-private-writer', instanceId: randomUUID(), mode: 'unknown' }),
      '{"pid":123,"pid":456,"kind":"sidaksa-private-writer"}',
    ];
    for (const value of cases) {
      await writeFile(lockPath(directory), value);
      await expect(acquireStoreLock(directory)).rejects.toMatchObject({ code: 'STORE_LOCKED' });
      expect(await readFile(lockPath(directory), 'utf8')).toBe(value);
    }
  });

  it('fails closed when OS liveness is denied or unverifiable', async () => {
    const directory = await isolated();
    const before = JSON.stringify({ pid: 123, kind: 'sidaksa-private-writer' });
    await writeFile(lockPath(directory), before);
    const probe = vi.spyOn(process, 'kill');
    for (const code of ['EPERM', 'EACCES', 'UNKNOWN']) {
      probe.mockImplementation(() => { throw Object.assign(new Error('probe denied'), { code }); });
      await expect(acquireStoreLock(directory)).rejects.toMatchObject({ code: 'STORE_LOCKED' });
      expect(await readFile(lockPath(directory), 'utf8')).toBe(before);
    }
  });

  it('records native process birth identity and refuses that same live identity', async () => {
    const directory = await isolated(); const release = await acquireStoreLock(directory, metadata); releases.push(release);
    const original = await readFile(lockPath(directory), 'utf8');
    const record = JSON.parse(original);
    expect(record.ownerIdentity).toMatchObject({ platform: process.platform, startedAt: expect.any(String), executable: expect.any(String) });
    await release(); await writeFile(lockPath(directory), original);
    await expect(acquireStoreLock(directory)).rejects.toMatchObject({ code: 'STORE_LOCKED' });
    expect(await readFile(lockPath(directory), 'utf8')).toBe(original);
  });

  it('recovers a synthetic reused PID only with a proven different native process birth identity', async () => {
    const directory = await isolated(); const release = await acquireStoreLock(directory); releases.push(release);
    const record = JSON.parse(await readFile(lockPath(directory), 'utf8'));
    expect(record.ownerIdentity).toBeDefined();
    await release();
    // Exact current PID remains alive; only the recorded predecessor birth time differs.
    record.ownerIdentity.startedAt = (BigInt(record.ownerIdentity.startedAt) - 1n).toString();
    await writeFile(lockPath(directory), JSON.stringify(record));
    const signal = vi.spyOn(process, 'kill');
    const recovered = await acquireStoreLock(directory); releases.push(recovered);
    const current = JSON.parse(await readFile(lockPath(directory), 'utf8'));
    expect(current.pid).toBe(process.pid);
    expect(current.ownerIdentity.startedAt).not.toBe(record.ownerIdentity.startedAt);
    expect(signal.mock.calls.every(call => call[1] === 0)).toBe(true);
    await recovered();
  });

  it('leaves a live legacy PID fail-closed because its process birth cannot be established', async () => {
    const directory = await isolated();
    const original = JSON.stringify({ pid: process.pid, kind: 'sidaksa-private-writer', ...metadata });
    await writeFile(lockPath(directory), original);
    await expect(acquireStoreLock(directory)).rejects.toMatchObject({ code: 'STORE_LOCKED' });
    expect(await readFile(lockPath(directory), 'utf8')).toBe(original);
  });

  it('native identity-query failure preserves an unverifiable live owner', async () => {
    if (process.platform !== 'win32') return;
    const directory = await isolated(); const release = await acquireStoreLock(directory); releases.push(release);
    const original = await readFile(lockPath(directory), 'utf8'); await release();
    await writeFile(lockPath(directory), original);
    const query = vi.spyOn(childProcess, 'execFile').mockImplementation(((...args: unknown[]) => {
      const done = args.at(-1) as (error: Error) => void;
      queueMicrotask(() => done(new Error('synthetic native-query denial')));
      return {} as ChildProcess;
    }) as typeof childProcess.execFile);
    await expect(acquireStoreLock(directory)).rejects.toMatchObject({ code: 'STORE_LOCKED' });
    expect(query).toHaveBeenCalledOnce();
    expect(query.mock.calls[0][2]).toMatchObject({ timeout: 4000, maxBuffer: 4096, windowsHide: true });
    expect(await readFile(lockPath(directory), 'utf8')).toBe(original);
  });

  it('keeps the kernel guard while an active owner has lost its pathname', async () => {
    const directory = await isolated(); const release = await acquireStoreLock(directory); releases.push(release);
    await rm(lockPath(directory));
    await expect(acquireStoreLock(directory)).rejects.toMatchObject({ code: 'STORE_LOCKED' });
    const otherProcess = await contender(directory);
    expect(await otherProcess.next()).toMatchObject({ status: 'refused', code: 'STORE_LOCKED' });
    await release();
    const replacement = await acquireStoreLock(directory); releases.push(replacement);
    expect(JSON.parse(await readFile(lockPath(directory), 'utf8')).pid).toBe(process.pid);
    await replacement();
  });

  it('removes its own lock on normal release and permits a fresh owner', async () => {
    const directory = await isolated(); const release = await acquireStoreLock(directory); releases.push(release);
    const first = JSON.parse(await readFile(lockPath(directory), 'utf8')).lockId;
    await Promise.all([release(), release()]);
    await expect(readFile(lockPath(directory))).rejects.toMatchObject({ code: 'ENOENT' });
    const replacement = await acquireStoreLock(directory); releases.push(replacement);
    expect(JSON.parse(await readFile(lockPath(directory), 'utf8')).lockId).not.toBe(first);
    await replacement();
  });

  it('release cannot unlink a replacement owner and remains idempotent', async () => {
    const directory = await isolated(); const release = await acquireStoreLock(directory, metadata); releases.push(release);
    await rename(lockPath(directory), path.join(directory, 'old-owner.lock'));
    const replacement = JSON.stringify({ pid: process.pid, kind: 'sidaksa-private-writer', instanceId: randomUUID(), mode: 'development' });
    await writeFile(lockPath(directory), replacement);
    await Promise.all([release(), release()]);
    expect(await readFile(lockPath(directory), 'utf8')).toBe(replacement);
  });

  it('release preserves a same-inode overwritten ownership record', async () => {
    const directory = await isolated(); const release = await acquireStoreLock(directory); releases.push(release);
    const replacement = JSON.stringify({ pid: process.pid, kind: 'sidaksa-private-writer', ...metadata });
    await writeFile(lockPath(directory), replacement);
    await release();
    expect(await readFile(lockPath(directory), 'utf8')).toBe(replacement);
  });
});
