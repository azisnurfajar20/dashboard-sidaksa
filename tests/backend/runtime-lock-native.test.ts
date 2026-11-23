import { afterEach, describe, expect, it, vi } from 'vitest';
import childProcess, { type ExecFileException, type ExecFileOptionsWithStringEncoding } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const scratch = path.resolve('.private/test-tmp');
const directories: string[] = [];
const releases: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(releases.splice(0).map(release => release()));
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});
async function isolated() {
  await mkdir(scratch, { recursive: true });
  const directory = await mkdtemp(path.join(scratch, 'runtime-native-'));
  directories.push(directory);
  return directory;
}

describe.skipIf(process.platform !== 'win32')('bounded Windows native process identity', () => {
  it('attests a fresh writer without depending on a stalled CIM provider', async () => {
    const directory = await isolated();
    const native = childProcess.execFile;
    const events: Array<Record<string, unknown>> = [];
    // A provider stall is injected only when CIM is requested. The executable,
    // native process observation, deadline, callback and filesystem stay real.
    vi.spyOn(childProcess, 'execFile').mockImplementation(((file: string, argv: string[], options: ExecFileOptionsWithStringEncoding,
      done: (error: ExecFileException | null, stdout: string, stderr: string) => void) => {
      const script = argv.at(-1)!;
      const stalledCim = script.includes('Get-CimInstance');
      const actualArgv = stalledCim ? [...argv.slice(0, -1), `Start-Sleep -Milliseconds 4500; ${script}`] : argv;
      const start = performance.now();
      return native(file, actualArgv, options, (error, stdout, stderr) => {
        let value: unknown;
        try { value = JSON.parse(stdout.replace(/^\uFEFF/, '').trim()); } catch { /* shape only */ }
        events.push({ stalledCim, durationMs: Math.round(performance.now() - start), errorCode: error?.code ?? null,
          killed: error?.killed ?? false, signal: error?.signal ?? null, timeout: options.timeout, maxBuffer: options.maxBuffer,
          stdoutBytes: Buffer.byteLength(stdout), stderrBytes: Buffer.byteLength(stderr),
          jsonObject: !!value && typeof value === 'object' && !Array.isArray(value) });
        done(error, stdout, stderr);
      });
    }) as typeof childProcess.execFile);
    vi.resetModules();
    const { acquireStoreLock } = await import('../../server/runtime-lock.js');
    let status = 'refused';
    try { releases.push(await acquireStoreLock(directory)); status = 'acquired'; }
    catch (error) { expect(error).toMatchObject({ code: 'STORE_LOCKED' }); }
    expect({ status }, JSON.stringify(events)).toEqual({ status: 'acquired' });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ stalledCim: false, errorCode: null, killed: false, signal: null,
      timeout: 4000, maxBuffer: 4096, stderrBytes: 0, jsonObject: true });
    const record = JSON.parse(await readFile(path.join(directory, '.runtime.lock'), 'utf8'));
    expect(record.ownerIdentity).toMatchObject({ platform: 'win32', executable: process.execPath });
    expect(record.ownerIdentity.startedAt).toMatch(/^[1-9]\d*0$/);
  });

  it('keeps exact CIM-compatible UTC ticks and a same-birth protected owner despite sub-microsecond native precision', async () => {
    const directory = await isolated();
    const native = childProcess.execFile;
    // An exact Int64 DateTime fixture reaches the real PowerShell serializer and
    // production arithmetic. A floating-point round-trip would lose these digits.
    const rawTicks = '639309715234567897', cimTicks = '639309715234567890';
    const image = `'${process.execPath.replace(/'/g, "''")}'`;
    vi.spyOn(childProcess, 'execFile').mockImplementation(((file: string, argv: string[], options: ExecFileOptionsWithStringEncoding,
      done: (error: ExecFileException | null, stdout: string, stderr: string) => void) => {
      const expression = `(& {$fixture=[pscustomobject]@{Id=${process.pid};StartTime=[datetime]::new([long]'${rawTicks}',[DateTimeKind]::Utc);MainModule=[pscustomobject]@{FileName=${image}}}; $fixture|Add-Member -MemberType ScriptMethod -Name Dispose -Value {}; $fixture})`;
      const script = argv.at(-1)!.replace(/\[System\.Diagnostics\.Process\]::GetProcessById\([1-9]\d*\)/, expression);
      return native(file, [...argv.slice(0, -1), script], options, done);
    }) as typeof childProcess.execFile);
    vi.resetModules();
    const { acquireStoreLock } = await import('../../server/runtime-lock.js');
    const release = await acquireStoreLock(directory); releases.push(release);
    const file = path.join(directory, '.runtime.lock');
    const record = JSON.parse(await readFile(file, 'utf8'));
    await release();
    // A previous CIM writer recorded this same process at microsecond precision.
    // Permission to signal is independent of the native birth observation.
    const legacyCim = JSON.stringify({ ...record, ownerIdentity: { ...record.ownerIdentity, startedAt: cimTicks } });
    await writeFile(file, legacyCim);
    const signal = vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('fixture-only signal-0 denial'), { code: 'EPERM' });
    });
    await expect(acquireStoreLock(directory).then(release => { releases.push(release); return release; }))
      .rejects.toMatchObject({ code: 'STORE_LOCKED' });
    expect(signal.mock.calls).toEqual([[process.pid, 0]]);
    expect(await readFile(file, 'utf8')).toBe(legacyCim);
    expect(record.ownerIdentity.startedAt).toBe(cimTicks);
  });

  it('still observes foreign birth when native executable access is denied independently', async () => {
    const directory = await isolated();
    vi.resetModules();
    const initial = await import('../../server/runtime-lock.js');
    const unlock = await initial.acquireStoreLock(directory); releases.push(unlock);
    const file = path.join(directory, '.runtime.lock');
    const record = JSON.parse(await readFile(file, 'utf8')); await unlock();
    record.ownerIdentity.startedAt = (BigInt(record.ownerIdentity.startedAt) - 10n).toString();
    await writeFile(file, JSON.stringify(record));
    const native = childProcess.execFile;
    const observations: Array<{ errorCode: string | number | null; executableEmpty: boolean }> = [];
    let queries = 0;
    vi.spyOn(childProcess, 'execFile').mockImplementation(((file: string, argv: string[], options: ExecFileOptionsWithStringEncoding,
      done: (error: ExecFileException | null, stdout: string, stderr: string) => void) => {
      const script = argv.at(-1)!;
      // Only the first (foreign) executable read is denied. The real birth read,
      // catch block, native callback, and subsequent strict self query execute.
      const query = queries++ === 0 ? script.replace('$image=$p.MainModule.FileName', 'throw [System.ComponentModel.Win32Exception]::new(5)') : script;
      return native(file, [...argv.slice(0, -1), query], options, (error, stdout, stderr) => {
        let value;
        try { value = JSON.parse(stdout.replace(/^\uFEFF/, '').trim()); } catch { /* safe shape */ }
        observations.push({ errorCode: error?.code ?? null, executableEmpty: value?.executable === '' });
        done(error, stdout, stderr);
      });
    }) as typeof childProcess.execFile);
    vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('fixture-only signal-0 denial'), { code: 'EACCES' });
    });
    vi.resetModules();
    const { acquireStoreLock } = await import('../../server/runtime-lock.js');
    releases.push(await acquireStoreLock(directory));
    expect(queries).toBe(2);
    expect(observations).toEqual([{ errorCode: null, executableEmpty: true }, { errorCode: null, executableEmpty: false }]);
    expect(JSON.parse(await readFile(file, 'utf8')).ownerIdentity.executable).toBe(process.execPath);
  });
});
