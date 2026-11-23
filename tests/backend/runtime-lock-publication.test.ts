import { afterEach, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile, lstat, link } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const scratch = path.resolve('.private/test-tmp');
const directories: string[] = [];
const children: ChildProcess[] = [];
const lockPath = (directory: string) => path.join(directory, '.runtime.lock');
const stagePath = (directory: string, id: string) => path.join(directory, `.runtime.lock.${id}.stage`);
type Message = { status: string; pid?: number; code?: string; file?: string };
type Phase = 'normal' | 'created' | 'partial' | 'before-publish' | 'after-publish' | 'io-write' | 'io-sync' | 'io-link' | 'io-cleanup' | 'collision';

async function waitForExit(child: ChildProcess) {
  if (child.exitCode === null && child.signalCode === null) await once(child, 'exit');
}
async function forceExit(child: ChildProcess, requireSignal = false) {
  if (requireSignal) expect({ exitCode: child.exitCode, signalCode: child.signalCode }).toEqual({ exitCode: null, signalCode: null });
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = waitForExit(child);
  const sent = child.kill('SIGKILL');
  if (requireSignal) expect(sent).toBe(true);
  await exited;
  if (requireSignal) expect(child.signalCode).toBe('SIGKILL');
}
afterEach(async () => {
  await Promise.all(children.splice(0).map(child => forceExit(child)));
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});
async function isolated() {
  await mkdir(scratch, { recursive: true });
  const directory = await mkdtemp(path.join(scratch, 'runtime-publication-'));
  directories.push(directory);
  await writeFile(path.join(directory, 'fixture-state.json'), 'PRIVATE-FIXTURE-UNCHANGED');
  return directory;
}

// Only the disposable child's built-in filesystem boundary is instrumented. The
// real runtime module, kernel guard, filesystem operations and SIGKILL are used.
async function contender(directory: string, phase: Phase = 'normal') {
  const helper = path.join(directory, `child-${randomUUID()}.mjs`);
  await writeFile(helper, `
    import fs from 'node:fs/promises';
    import path from 'node:path';
    import { syncBuiltinESMExports } from 'node:module';
    const directory = ${JSON.stringify(directory)};
    const phase = ${JSON.stringify(phase)};
    const authoritative = path.join(directory, '.runtime.lock');
    const original = { open: fs.open, link: fs.link, unlink: fs.unlink };
    const timer = setInterval(() => {}, 1000);
    const ioError = () => Object.assign(new Error('fixture-only I/O failure'), { code: 'EIO' });
    const barrier = async file => { process.send({ status: 'barrier', file }); await new Promise(() => {}); };
    const target = file => typeof file === 'string' && path.dirname(file) === directory &&
      (file === authoritative || /^\\.runtime\\.lock\\.[0-9a-f-]{36}\\.stage$/i.test(path.basename(file)));
    fs.open = async function(file, ...args) {
      const handle = await original.open.call(fs, file, ...args);
      if (args[0] !== 'wx' || !target(file)) return handle;
      if (phase === 'created') await barrier(file);
      const write = handle.writeFile.bind(handle), sync = handle.sync.bind(handle);
      handle.writeFile = async function(text, ...options) {
        if (phase === 'partial' || phase === 'io-write') {
          await write(text.slice(0, Math.floor(text.length / 2)), ...options);
          if (phase === 'partial') await barrier(file);
          throw ioError();
        }
        return write(text, ...options);
      };
      handle.sync = async function() {
        if (phase === 'io-sync') throw ioError();
        await sync();
        // Compatibility with the broken direct-write path keeps its RED signal
        // about publication semantics, rather than a missing test barrier.
        if (file === authoritative && (phase === 'before-publish' || phase === 'after-publish')) await barrier(file);
      };
      return handle;
    };
    fs.link = async function(from, to) {
      if (to !== authoritative) return original.link.call(fs, from, to);
      if (phase === 'before-publish') await barrier(from);
      if (phase === 'io-link') throw ioError();
      if (phase === 'collision') await fs.writeFile(to, 'PREEXISTING-OWNER-MUST-SURVIVE', { flag: 'wx' });
      await original.link.call(fs, from, to);
      if (phase === 'after-publish') await barrier(from);
    };
    fs.unlink = async function(file) {
      if (phase === 'io-cleanup' && target(file) && file !== authoritative) throw ioError();
      return original.unlink.call(fs, file);
    };
    syncBuiltinESMExports();
    const { acquireStoreLock } = await import(${JSON.stringify(pathToFileURL(path.resolve('server/runtime-lock.ts')).href)});
    let release;
    process.on('message', async message => {
      if (message === 'go') {
        try { release = await acquireStoreLock(directory); process.send({ status: 'acquired', pid: process.pid }); }
        catch (error) { process.send({ status: 'refused', code: error.code }); clearInterval(timer); process.disconnect(); }
      } else if (message === 'release' && release) {
        try { await release(); process.send({ status: 'released' }); }
        catch (error) { process.send({ status: 'release-error', code: error.code }); }
        finally { clearInterval(timer); process.disconnect(); }
      }
    });
    process.send({ status: 'ready', pid: process.pid });
  `);
  const child = spawn(process.execPath, ['--import', 'tsx', helper], {
    cwd: path.resolve('.'), stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: { ...process.env, TMP: scratch, TEMP: scratch, TMPDIR: scratch, TSX_CACHE_DIR: path.join(scratch, 'tsx-cache') },
  });
  children.push(child);
  let stderr = ''; child.stderr!.on('data', chunk => { stderr = (stderr + chunk).slice(-4096); });
  const messages: Message[] = [];
  let wake: ((message: Message) => void) | undefined;
  child.on('message', message => { if (wake) { const resolve = wake; wake = undefined; resolve(message as Message); } else messages.push(message as Message); });
  const next = () => new Promise<Message>((resolve, reject) => {
    if (messages.length) return resolve(messages.shift()!);
    if (child.exitCode !== null || child.signalCode !== null) return reject(new Error(`Fixture child already exited: ${stderr}`));
    const timeout = setTimeout(() => done(new Error(`Fixture IPC timeout: ${stderr}`)), 12000);
    const onExit = () => done(new Error(`Fixture exited before IPC result: ${stderr}`));
    function done(error?: Error, message?: Message) {
      clearTimeout(timeout); child.off('exit', onExit); child.off('error', done); wake = undefined;
      if (error) reject(error); else resolve(message!);
    }
    child.once('exit', onExit); child.once('error', done); wake = message => done(undefined, message);
  });
  expect(await next()).toMatchObject({ status: 'ready' });
  return { child, next, go: () => child.send('go') };
}
async function restart(directory: string) {
  const worker = await contender(directory); worker.go();
  expect(await worker.next()).toMatchObject({ status: 'acquired' });
  expect(await readFile(path.join(directory, 'fixture-state.json'), 'utf8')).toBe('PRIVATE-FIXTURE-UNCHANGED');
  return worker;
}
async function release(worker: Awaited<ReturnType<typeof contender>>) {
  worker.child.send('release');
  expect(await worker.next()).toMatchObject({ status: 'released' });
}

describe('atomic private writer metadata publication', () => {
  it('recovers after SIGKILL immediately after exclusive metadata-file creation without exposing an empty authoritative lock', async () => {
    const directory = await isolated();
    const owner = await contender(directory, 'created'); owner.go();
    const paused = await owner.next(); expect(paused.status).toBe('barrier');
    expect((await lstat(paused.file!)).size).toBe(0);
    await forceExit(owner.child, true);
    const recovered = await contender(directory); recovered.go();
    const result = await recovered.next();
    expect(result, JSON.stringify(result)).toMatchObject({ status: 'acquired' });
    expect(paused.file).not.toBe(lockPath(directory));
    expect(await readFile(path.join(directory, 'fixture-state.json'), 'utf8')).toBe('PRIVATE-FIXTURE-UNCHANGED');
    await release(recovered);
    await expect(readFile(lockPath(directory))).rejects.toMatchObject({ code: 'ENOENT' });
  }, 45000);

  it.each(['partial', 'before-publish'] as const)('recovers after SIGKILL at %s without publishing incomplete metadata', async phase => {
    const directory = await isolated(); const owner = await contender(directory, phase); owner.go();
    const paused = await owner.next(); expect(paused.status).toBe('barrier');
    expect(paused.file).not.toBe(lockPath(directory));
    const stage = await readFile(paused.file!, 'utf8');
    if (phase === 'partial') expect(() => JSON.parse(stage)).toThrow();
    else expect(JSON.parse(stage)).toMatchObject({ pid: owner.child.pid, lockId: expect.any(String) });
    await expect(readFile(lockPath(directory))).rejects.toMatchObject({ code: 'ENOENT' });
    await forceExit(owner.child, true);
    const recovered = await restart(directory); await release(recovered);
    // Orphan private stages are not authoritative and are not glob-deleted.
    expect(await readFile(paused.file!, 'utf8')).toBe(stage);
  }, 45000);

  it('recovers a complete two-link publication after SIGKILL before staging cleanup', async () => {
    const directory = await isolated(); const owner = await contender(directory, 'after-publish'); owner.go();
    const paused = await owner.next(); expect(paused.status).toBe('barrier');
    const text = await readFile(lockPath(directory), 'utf8'); const record = JSON.parse(text);
    expect(paused.file).toBe(stagePath(directory, record.lockId));
    const [published, stage] = await Promise.all([lstat(lockPath(directory), { bigint: true }), lstat(paused.file!, { bigint: true })]);
    expect(published.nlink).toBe(2n); expect(stage.ino).toBe(published.ino); expect(stage.dev).toBe(published.dev);
    expect(await readFile(paused.file!, 'utf8')).toBe(text);
    const blocked = await contender(directory); blocked.go();
    expect(await blocked.next()).toMatchObject({ status: 'refused', code: 'STORE_LOCKED' });
    await forceExit(owner.child, true);
    const recovered = await restart(directory);
    await expect(readFile(paused.file!)).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await lstat(lockPath(directory))).nlink).toBe(1);
    await release(recovered);
  }, 45000);

  it('permits exactly one simultaneous restart from a crashed two-link publication', async () => {
    const directory = await isolated(); const owner = await contender(directory, 'after-publish'); owner.go();
    const paused = await owner.next(); expect(paused.status).toBe('barrier');
    await forceExit(owner.child, true);
    const workers = await Promise.all([contender(directory), contender(directory)]);
    workers.forEach(worker => worker.go());
    const outcomes = await Promise.all(workers.map(worker => worker.next()));
    expect(outcomes.filter(result => result.status === 'acquired')).toHaveLength(1);
    expect(outcomes.filter(result => result.status === 'refused' && result.code === 'STORE_LOCKED')).toHaveLength(1);
    const winner = outcomes.findIndex(result => result.status === 'acquired');
    expect(JSON.parse(await readFile(lockPath(directory), 'utf8')).pid).toBe(outcomes[winner].pid);
    await expect(readFile(paused.file!)).rejects.toMatchObject({ code: 'ENOENT' });
    await release(workers[winner]);
  }, 45000);

  it.each(['io-write', 'io-sync'] as const)('preserves a stale authoritative owner if preparation fails at %s', async phase => {
    const directory = await isolated(); const old = await restart(directory);
    const original = await readFile(lockPath(directory), 'utf8'); await forceExit(old.child, true);
    const faulty = await contender(directory, phase); faulty.go();
    expect(await faulty.next()).toMatchObject({ status: 'refused', code: 'EIO' });
    await waitForExit(faulty.child);
    expect(await readFile(lockPath(directory), 'utf8')).toBe(original);
    expect((await readdir(directory)).filter(file => file.endsWith('.stage'))).toHaveLength(0);
    const recovered = await restart(directory); await release(recovered);
  }, 45000);

  it('leaves no authoritative record when no-replace publication fails with an I/O error', async () => {
    const directory = await isolated(); const faulty = await contender(directory, 'io-link'); faulty.go();
    expect(await faulty.next()).toMatchObject({ status: 'refused', code: 'STORE_LOCKED' });
    await waitForExit(faulty.child);
    await expect(readFile(lockPath(directory))).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await readdir(directory)).filter(file => file.endsWith('.stage'))).toHaveLength(0);
    const recovered = await restart(directory); await release(recovered);
  }, 45000);

  it('recovers a committed two-link record after staging cleanup returns an I/O error', async () => {
    const directory = await isolated(); const faulty = await contender(directory, 'io-cleanup'); faulty.go();
    expect(await faulty.next()).toMatchObject({ status: 'refused', code: 'EIO' });
    await waitForExit(faulty.child);
    const record = JSON.parse(await readFile(lockPath(directory), 'utf8'));
    expect((await lstat(lockPath(directory))).nlink).toBe(2);
    expect(await readFile(stagePath(directory, record.lockId), 'utf8')).toBe(await readFile(lockPath(directory), 'utf8'));
    const recovered = await restart(directory); await release(recovered);
    await expect(readFile(stagePath(directory, record.lockId))).rejects.toMatchObject({ code: 'ENOENT' });
  }, 45000);

  it('never overwrites a destination introduced at the atomic publication boundary', async () => {
    const directory = await isolated(); const faulty = await contender(directory, 'collision'); faulty.go();
    expect(await faulty.next()).toMatchObject({ status: 'refused', code: 'STORE_LOCKED' });
    await waitForExit(faulty.child);
    expect(await readFile(lockPath(directory), 'utf8')).toBe('PREEXISTING-OWNER-MUST-SURVIVE');
    expect((await readdir(directory)).filter(file => file.endsWith('.stage'))).toHaveLength(0);
    const retry = await contender(directory); retry.go();
    expect(await retry.next()).toMatchObject({ status: 'refused', code: 'STORE_LOCKED' });
    expect(await readFile(lockPath(directory), 'utf8')).toBe('PREEXISTING-OWNER-MUST-SURVIVE');
  }, 45000);

  it('preserves preexisting empty, partial and malformed authoritative locks fail-closed', async () => {
    const directory = await isolated();
    for (const text of ['', '{broken', 'null']) {
      await writeFile(lockPath(directory), text);
      const worker = await contender(directory); worker.go();
      expect(await worker.next()).toMatchObject({ status: 'refused', code: 'STORE_LOCKED' });
      await waitForExit(worker.child);
      expect(await readFile(lockPath(directory), 'utf8')).toBe(text);
      expect((await readdir(directory)).filter(file => file.endsWith('.stage'))).toHaveLength(0);
    }
  }, 45000);

  it.each(['external', 'wrong-lock-id', 'different-inode', 'third-link', 'missing-native-identity'] as const)('refuses %s hardlink evidence rather than accepting arbitrary external links', async shape => {
    const directory = await isolated(); const owner = await restart(directory);
    const record = JSON.parse(await readFile(lockPath(directory), 'utf8')); await forceExit(owner.child, true);
    if (shape === 'missing-native-identity') { delete record.ownerIdentity; await writeFile(lockPath(directory), JSON.stringify(record)); }
    const expectedStage = stagePath(directory, record.lockId);
    if (shape === 'external' || shape === 'different-inode') await link(lockPath(directory), path.join(directory, 'external.link'));
    if (shape === 'wrong-lock-id') await link(lockPath(directory), stagePath(directory, randomUUID()));
    if (shape === 'different-inode') await writeFile(expectedStage, await readFile(lockPath(directory)));
    if (shape === 'third-link' || shape === 'missing-native-identity') await link(lockPath(directory), expectedStage);
    if (shape === 'third-link') await link(lockPath(directory), path.join(directory, 'third.link'));
    const original = await readFile(lockPath(directory), 'utf8');
    const links = (await lstat(lockPath(directory))).nlink;
    const blocked = await contender(directory); blocked.go();
    expect(await blocked.next()).toMatchObject({ status: 'refused', code: 'STORE_LOCKED' });
    expect(await readFile(lockPath(directory), 'utf8')).toBe(original);
    expect((await lstat(lockPath(directory))).nlink).toBe(links);
  }, 45000);

  it('does not treat a valid staging alias as proof that a same-birth live owner is dead', async () => {
    const directory = await isolated();
    const { acquireStoreLock } = await import('../../server/runtime-lock.js');
    const unlock = await acquireStoreLock(directory);
    const original = await readFile(lockPath(directory), 'utf8'); await unlock();
    const record = JSON.parse(original); await writeFile(lockPath(directory), original);
    await link(lockPath(directory), stagePath(directory, record.lockId));
    const blocked = await contender(directory); blocked.go();
    expect(await blocked.next()).toMatchObject({ status: 'refused', code: 'STORE_LOCKED' });
    expect(await readFile(lockPath(directory), 'utf8')).toBe(original);
    expect((await lstat(lockPath(directory))).nlink).toBe(2);
  }, 45000);
});
