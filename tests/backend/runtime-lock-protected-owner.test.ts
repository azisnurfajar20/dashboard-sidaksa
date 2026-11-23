import { afterEach, describe, expect, it, vi } from 'vitest';
import childProcess, { type ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const scratch = path.resolve('.private/test-tmp');
const directories: string[] = [];
const releases: Array<() => Promise<void>> = [];
// A synthetic PID, intercepted at both OS boundaries; never signal/query a live foreign process.
const foreignPid = process.pid === 2147483647 ? process.pid - 1 : process.pid + 1;
const recordedIdentity = { platform: 'win32', startedAt: '1', executable: process.execPath };
const verifiedSelf = { pid: process.pid, startedAt: '3', executable: process.execPath };
const oldRecord = { pid: foreignPid, kind: 'sidaksa-private-writer', ownerIdentity: recordedIdentity };
const differentBirth = { pid: foreignPid, startedAt: '2', executable: '' };
const malformedBirths = [
  { label: 'missing', value: undefined }, { label: 'null', value: null },
  { label: 'numeric', value: 2 }, { label: 'empty', value: '' },
  { label: 'zero', value: '0' }, { label: 'negative', value: '-2' },
  { label: 'zero-padded', value: '02' }, { label: 'fractional', value: '2.5' },
  { label: 'exponential', value: '2e3' }, { label: 'whitespace', value: ' 2' },
  { label: 'trailing newline', value: '2\n' }, { label: 'overlong', value: '2'.repeat(26) },
];

interface FixtureOptions { denial?: string; self?: unknown; record?: unknown; signalAllowed?: boolean }

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(releases.splice(0).map(release => release()));
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

async function arrange(foreign: unknown, options: FixtureOptions = {}) {
  await mkdir(scratch, { recursive: true });
  const directory = await mkdtemp(path.join(scratch, 'runtime-protected-owner-'));
  directories.push(directory);
  const file = path.join(directory, '.runtime.lock');
  const original = JSON.stringify(options.record ?? oldRecord);
  await writeFile(file, original);
  const signal = vi.spyOn(process, 'kill').mockImplementation(() => {
    if (options.signalAllowed) return true;
    throw Object.assign(new Error('synthetic signal-0 denial'), { code: options.denial ?? 'EPERM' });
  });
  const replies = { foreign, self: Object.hasOwn(options, 'self') ? options.self : verifiedSelf };
  const requestedPids: number[] = [];
  const query = vi.spyOn(childProcess, 'execFile').mockImplementation(((...args: unknown[]) => {
    const argv = args[1] as string[];
    const done = args.at(-1) as (error: Error | null, stdout: string) => void;
    const pid = Number(argv.at(-1)?.match(/::GetProcessById\(([1-9]\d*)\)/)?.[1]);
    requestedPids.push(pid);
    const reply = pid === foreignPid ? replies.foreign : pid === process.pid ? replies.self : undefined;
    queueMicrotask(() => reply instanceof Error ? done(reply, '') : done(null, JSON.stringify(reply) ?? 'invalid'));
    return {} as ChildProcess;
  }) as typeof childProcess.execFile);
  // Each case must exercise first-owner verification, not a previous case's identity cache.
  vi.resetModules();
  const { acquireStoreLock } = await import('../../server/runtime-lock.js');
  return { directory, file, original, signal, query, requestedPids, replies, acquireStoreLock };
}

function expectBoundary(fixture: Awaited<ReturnType<typeof arrange>>, pids: number[], signals: unknown[][] = [[foreignPid, 0]]) {
  expect(fixture.signal.mock.calls).toEqual(signals);
  expect(fixture.requestedPids).toEqual(pids);
  for (const call of fixture.query.mock.calls) {
    expect(call[0]).toBe(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'));
    expect(call[1]).toEqual(['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', expect.any(String)]);
    expect(call[2]).toEqual({ timeout: 4000, maxBuffer: 4096, windowsHide: true, encoding: 'utf8' });
  }
}

describe.skipIf(process.platform !== 'win32')('protected foreign owner native-birth recovery', () => {
  it.each(['EPERM', 'EACCES'])('recovers a %s signal-0 owner when native birth differs despite an unavailable foreign executable', async denial => {
    const fixture = await arrange(differentBirth, { denial });
    const release = await fixture.acquireStoreLock(fixture.directory);
    releases.push(release);
    expect(JSON.parse(await readFile(fixture.file, 'utf8'))).toMatchObject({ pid: process.pid, ownerIdentity: { ...recordedIdentity, startedAt: '3' } });
    expectBoundary(fixture, [foreignPid, process.pid]);
    await Promise.all([release(), release()]);
    await expect(readFile(fixture.file)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each([{ label: 'null', executable: null }, { label: 'omitted', executable: undefined }])('does not require a $label foreign executable when birth proves replacement', async ({ executable }) => {
    const fixture = await arrange({ ...differentBirth, executable });
    const release = await fixture.acquireStoreLock(fixture.directory); releases.push(release);
    expect(JSON.parse(await readFile(fixture.file, 'utf8')).ownerIdentity).toEqual({ ...recordedIdentity, startedAt: '3' });
    expectBoundary(fixture, [foreignPid, process.pid]);
  });

  it('uses foreign birth rather than executable access after a successful signal-0 probe too', async () => {
    const fixture = await arrange(differentBirth, { signalAllowed: true });
    const release = await fixture.acquireStoreLock(fixture.directory); releases.push(release);
    expectBoundary(fixture, [foreignPid, process.pid]);
    expect(JSON.parse(await readFile(fixture.file, 'utf8')).pid).toBe(process.pid);
  });

  it.each(['EPERM', 'EACCES'])('keeps a %s owner with the same native birth locked even without foreign executable access', async denial => {
    const fixture = await arrange({ ...differentBirth, startedAt: recordedIdentity.startedAt }, { denial });
    await expect(fixture.acquireStoreLock(fixture.directory)).rejects.toMatchObject({ code: 'STORE_LOCKED' });
    expect(await readFile(fixture.file, 'utf8')).toBe(fixture.original);
    expectBoundary(fixture, [foreignPid]);
  });

  it.each(['EPERM', 'EACCES'])('keeps a %s owner locked when its native query fails', async denial => {
    const fixture = await arrange(new Error('synthetic native-query failure'), { denial });
    await expect(fixture.acquireStoreLock(fixture.directory)).rejects.toMatchObject({ code: 'STORE_LOCKED' });
    expect(await readFile(fixture.file, 'utf8')).toBe(fixture.original);
    expectBoundary(fixture, [foreignPid]);
  });

  it.each([
    { label: 'null result', reply: null },
    { label: 'non-object result', reply: 'not a native process observation' },
    { label: 'missing PID', reply: { startedAt: '2', executable: '' } },
    { label: 'wrong numeric PID', reply: { ...differentBirth, pid: process.pid } },
    { label: 'string PID', reply: { ...differentBirth, pid: String(foreignPid) } },
    { label: 'array result', reply: [differentBirth] },
  ])('keeps native $label fail-closed instead of inferring a dead protected owner', async ({ reply }) => {
    const fixture = await arrange(reply);
    await expect(fixture.acquireStoreLock(fixture.directory)).rejects.toMatchObject({ code: 'STORE_LOCKED' });
    expect(await readFile(fixture.file, 'utf8')).toBe(fixture.original);
    expectBoundary(fixture, [foreignPid]);
  });

  it.each(malformedBirths)('rejects a $label native foreign birth without touching the record', async ({ value }) => {
    const fixture = await arrange({ ...differentBirth, startedAt: value });
    await expect(fixture.acquireStoreLock(fixture.directory)).rejects.toMatchObject({ code: 'STORE_LOCKED' });
    expect(await readFile(fixture.file, 'utf8')).toBe(fixture.original);
    expectBoundary(fixture, [foreignPid]);
  });

  it.each(malformedBirths)('rejects a $label recorded birth before any OS identity probe', async ({ value }) => {
    const fixture = await arrange(differentBirth, { record: { ...oldRecord, ownerIdentity: { ...recordedIdentity, startedAt: value } } });
    await expect(fixture.acquireStoreLock(fixture.directory)).rejects.toMatchObject({ code: 'STORE_LOCKED' });
    expect(await readFile(fixture.file, 'utf8')).toBe(fixture.original);
    expectBoundary(fixture, [], []);
  });

  it.each(['EPERM', 'EACCES', 'UNKNOWN'])('keeps a legacy owner with %s fail-closed without inventing a birth identity', async denial => {
    const fixture = await arrange(differentBirth, { denial, record: { pid: foreignPid, kind: 'sidaksa-private-writer' } });
    await expect(fixture.acquireStoreLock(fixture.directory)).rejects.toMatchObject({ code: 'STORE_LOCKED' });
    expect(await readFile(fixture.file, 'utf8')).toBe(fixture.original);
    expectBoundary(fixture, []);
  });

  it('does not treat an unexpected signal-0 error as permission to recover a known owner', async () => {
    const fixture = await arrange(differentBirth, { denial: 'UNKNOWN' });
    await expect(fixture.acquireStoreLock(fixture.directory)).rejects.toMatchObject({ code: 'STORE_LOCKED' });
    expect(await readFile(fixture.file, 'utf8')).toBe(fixture.original);
    expectBoundary(fixture, []);
  });

  it('keeps a foreign-platform recorded owner fail-closed', async () => {
    const fixture = await arrange(differentBirth, { record: { ...oldRecord, ownerIdentity: { ...recordedIdentity, platform: 'linux', bootId: '00000000-0000-0000-0000-000000000001' } } });
    await expect(fixture.acquireStoreLock(fixture.directory)).rejects.toMatchObject({ code: 'STORE_LOCKED' });
    expect(await readFile(fixture.file, 'utf8')).toBe(fixture.original);
    expectBoundary(fixture, []);
  });

  it.each([
    { label: 'null observation', reply: null },
    { label: 'omitted executable', reply: { pid: process.pid, startedAt: '3' } },
    { label: 'empty executable', reply: { ...verifiedSelf, executable: '' } },
    { label: 'null executable', reply: { ...verifiedSelf, executable: null } },
    { label: 'non-string executable', reply: { ...verifiedSelf, executable: 1 } },
    { label: 'different executable', reply: { ...verifiedSelf, executable: path.join(path.dirname(process.execPath), 'not-the-current-executable.exe') } },
    { label: 'missing birth', reply: { pid: process.pid, executable: process.execPath } },
    { label: 'malformed birth', reply: { ...verifiedSelf, startedAt: '03' } },
    { label: 'wrong PID', reply: { ...verifiedSelf, pid: foreignPid } },
    { label: 'failed native query', reply: new Error('synthetic self-query failure') },
  ])('verifies self identity before replacing a proven stale owner: $label', async ({ reply }) => {
    const fixture = await arrange(differentBirth, { self: reply });
    await expect(fixture.acquireStoreLock(fixture.directory)).rejects.toMatchObject({ code: 'STORE_LOCKED' });
    expect(await readFile(fixture.file, 'utf8')).toBe(fixture.original);
    expectBoundary(fixture, [foreignPid, process.pid]);
  });

  it('releases the kernel guard and retries native self verification after a failed attempt', async () => {
    const fixture = await arrange(differentBirth, { self: { ...verifiedSelf, executable: '' } });
    await expect(fixture.acquireStoreLock(fixture.directory)).rejects.toMatchObject({ code: 'STORE_LOCKED' });
    expect(await readFile(fixture.file, 'utf8')).toBe(fixture.original);
    fixture.replies.self = verifiedSelf;
    const release = await fixture.acquireStoreLock(fixture.directory); releases.push(release);
    expectBoundary(fixture, [foreignPid, process.pid, foreignPid, process.pid], [[foreignPid, 0], [foreignPid, 0]]);
    expect(JSON.parse(await readFile(fixture.file, 'utf8')).ownerIdentity).toEqual({ ...recordedIdentity, startedAt: '3' });
  });

  it('never writes a fresh owner record when the native self executable is unavailable', async () => {
    const fixture = await arrange(differentBirth, { self: { ...verifiedSelf, executable: '' } });
    await rm(fixture.file);
    await expect(fixture.acquireStoreLock(fixture.directory)).rejects.toMatchObject({ code: 'STORE_LOCKED' });
    await expect(readFile(fixture.file)).rejects.toMatchObject({ code: 'ENOENT' });
    expectBoundary(fixture, [process.pid], []);
  });
});
