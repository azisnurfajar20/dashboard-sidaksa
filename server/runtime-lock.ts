import { createHash, randomUUID } from 'node:crypto';
import childProcess from 'node:child_process';
import { link, lstat, mkdir, open, readFile, realpath, unlink, type FileHandle } from 'node:fs/promises';
import type { BigIntStats } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { ApiError } from './auth.js';

interface ProcessIdentity {
  platform: 'win32' | 'linux';
  startedAt: string;
  executable: string;
  bootId?: string;
}
// A foreign process may expose its birth identity without granting executable access.
type ProcessObservation = Omit<ProcessIdentity, 'executable'> & { executable: unknown };
interface LockRecord {
  pid: number;
  kind: 'sidaksa-private-writer';
  instanceId?: string;
  mode?: 'production' | 'development';
  lockId?: string;
  ownerIdentity?: ProcessIdentity;
}
interface LockSnapshot { text: string; stat: BigIntStats; stage?: string }
type RuntimeIdentity = { instanceId: string; mode: 'production' | 'development' };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const locked = () => new ApiError(409, 'STORE_LOCKED', 'Penyimpanan privat dikunci proses aktif atau pemiliknya belum dapat diverifikasi. Lock ambigu memerlukan pemeriksaan operator.');
const codeOf = (error: unknown) => (error as NodeJS.ErrnoException).code;
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const validPid = (pid: unknown): pid is number => Number.isSafeInteger(pid) && (pid as number) > 0 && (pid as number) <= 2147483647;
const validBirth = (value: unknown): value is string => typeof value === 'string' && /^[1-9]\d{0,24}$/.test(value);
function isIdentity(value: unknown): value is ProcessIdentity {
  if (!isObject(value) || !['win32', 'linux'].includes(value.platform as string) ||
      !validBirth(value.startedAt) ||
      typeof value.executable !== 'string' || !value.executable || value.executable.length > 2048 ||
      Object.keys(value).some(key => !['platform', 'startedAt', 'executable', 'bootId'].includes(key))) return false;
  return value.platform === 'win32' ? value.bootId === undefined : typeof value.bootId === 'string' && uuid.test(value.bootId);
}
function parseRecord(text: string): LockRecord {
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw locked(); }
  if (!isObject(value) || !validPid(value.pid) || value.kind !== 'sidaksa-private-writer' ||
      Object.keys(value).some(key => !['pid', 'kind', 'instanceId', 'mode', 'lockId', 'ownerIdentity'].includes(key)) ||
      (value.instanceId !== undefined || value.mode !== undefined) &&
        (typeof value.instanceId !== 'string' || !uuid.test(value.instanceId) || !['production', 'development'].includes(value.mode as string)) ||
      value.lockId !== undefined && (typeof value.lockId !== 'string' || !uuid.test(value.lockId)) ||
      value.ownerIdentity !== undefined && !isIdentity(value.ownerIdentity)) throw locked();
  // These records have only scalar fields and one flat identity object. Reject duplicate
  // keys (including escaped spellings) rather than trusting JSON.parse's last-key wins.
  const keys = Object.keys(value).length + (isObject(value.ownerIdentity) ? Object.keys(value.ownerIdentity).length : 0);
  if ((text.match(/"(?:\\.|[^"\\])*"\s*:/g) || []).length !== keys) throw locked();
  return value as unknown as LockRecord;
}

async function inspectProcess(pid: number): Promise<ProcessObservation | null> {
  if (!validPid(pid)) throw locked();
  if (process.platform === 'win32') {
    // Numeric-only interpolation; no shell, command line, credentials, or unbounded output.
    // Read the local kernel birth time without the CIM provider's startup/IPC cost.
    // CIM CreationDate retained only microseconds: truncate the native 100ns tick
    // remainder using Int64 arithmetic so existing records stay exactly comparable.
    const script = `$ErrorActionPreference='Stop'; $p=[System.Diagnostics.Process]::GetProcessById(${pid}); try{$ticks=$p.StartTime.ToUniversalTime().Ticks; $image=''; try{$image=$p.MainModule.FileName}catch{}; @{pid=[int]$p.Id;startedAt=($ticks-($ticks%10)).ToString([cultureinfo]::InvariantCulture);executable=[string]$image}|ConvertTo-Json -Compress}finally{$p.Dispose()}`;
    const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const stdout = await new Promise<string>((resolve, reject) => {
      childProcess.execFile(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
        { timeout: 4000, maxBuffer: 4096, windowsHide: true, encoding: 'utf8' },
        (error, output) => error ? reject(locked()) : resolve(output));
    });
    let result: unknown;
    try { result = JSON.parse(stdout.replace(/^\uFEFF/, '').trim()); } catch { throw locked(); }
    if (result === null) return null;
    if (!isObject(result) || result.pid !== pid || !validBirth(result.startedAt)) throw locked();
    return { platform: 'win32', startedAt: result.startedAt, executable: result.executable };
  }
  if (process.platform === 'linux') {
    const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
    const startedAt = stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19];
    const identity = { platform: 'linux', startedAt, executable: await realpath(`/proc/${pid}/exe`), bootId: (await readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim() };
    if (!isIdentity(identity)) throw locked();
    return identity;
  }
  // No unsafe age-based or PID-only fallback on unsupported systems.
  throw locked();
}
let ownIdentity: Promise<ProcessIdentity> | undefined;
function identityForSelf(): Promise<ProcessIdentity> {
  if (!ownIdentity) ownIdentity = inspectProcess(process.pid).then(identity => {
    if (!isIdentity(identity)) throw locked();
    const expected = process.platform === 'win32' ? process.execPath.toLowerCase() : process.execPath;
    const actual = process.platform === 'win32' ? identity.executable.toLowerCase() : identity.executable;
    if (expected !== actual) throw locked();
    return identity;
  }).catch(error => { ownIdentity = undefined; throw error; });
  return ownIdentity;
}
async function definitelyDead(owner: LockRecord): Promise<boolean> {
  try { process.kill(owner.pid, 0); }
  catch (error) {
    const code = codeOf(error);
    if (code === 'ESRCH') return true;
    // Signal permission is not birth-identity evidence. Query only known native
    // owners below; legacy owners and all unverified observations stay locked.
    if (code !== 'EPERM' && code !== 'EACCES') return false;
  }
  // A reused live PID is not proof that the original writer lives. Only a native
  // birth-identity mismatch proves replacement; legacy live PIDs remain ambiguous.
  if (!owner.ownerIdentity || owner.ownerIdentity.platform !== process.platform) return false;
  const current = await inspectProcess(owner.pid);
  if (!current) return false;
  return current.startedAt !== owner.ownerIdentity.startedAt ||
    current.platform === 'linux' && current.bootId !== owner.ownerIdentity.bootId;
}

async function kernelGuard(directory: string): Promise<() => Promise<void>> {
  const stat = await lstat(directory, { bigint: true });
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.ino === 0n) throw locked();
  // Directory identity, not path spelling: aliases/case variants share one mutex.
  const id = createHash('sha256').update(`${stat.dev}:${stat.ino}`).digest('hex');
  const address = process.platform === 'win32' ? `\\\\.\\pipe\\sidaksa-writer-${id}` :
    process.platform === 'linux' ? `\0sidaksa-writer-${id}` : undefined;
  if (!address) throw locked();
  const guard = createServer(socket => socket.destroy());
  await new Promise<void>((resolve, reject) => {
    guard.once('error', reject);
    guard.listen({ path: address, exclusive: true }, () => { guard.removeListener('error', reject); resolve(); });
  }).catch(() => { throw locked(); });
  guard.unref();
  return () => new Promise<void>((resolve, reject) => guard.close(error => error ? reject(error) : resolve()));
}
const sameFile = (a: BigIntStats, b: BigIntStats) => a.dev === b.dev && a.ino === b.ino;
const unchangedFile = (a: BigIntStats, b: BigIntStats) => sameFile(a, b) && a.nlink === b.nlink &&
  a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
async function snapshot(file: string): Promise<LockSnapshot | undefined> {
  let before: BigIntStats;
  try { before = await lstat(file, { bigint: true }); }
  catch (error) { if (codeOf(error) === 'ENOENT') return undefined; throw locked(); }
  try {
    if (!before.isFile() || before.isSymbolicLink() || before.ino === 0n ||
        (before.nlink !== 1n && before.nlink !== 2n) || before.size > 4096n) throw locked();
    const text = await readFile(file, 'utf8');
    const after = await lstat(file, { bigint: true });
    if (!unchangedFile(before, after)) throw locked();
    let stage: string | undefined;
    if (after.nlink === 2n) {
      // Only the exact publication residue is admissible, never arbitrary hardlinks.
      // Its filename is bound to validated metadata, with the same inode AND bytes.
      const record = parseRecord(text);
      if (path.basename(file) !== '.runtime.lock' || !record.lockId || !record.ownerIdentity) throw locked();
      stage = path.join(path.dirname(file), `.runtime.lock.${record.lockId}.stage`);
      const alias = await lstat(stage, { bigint: true });
      if (!alias.isFile() || alias.isSymbolicLink() || !unchangedFile(after, alias) ||
          await readFile(stage, 'utf8') !== text ||
          !unchangedFile(alias, await lstat(stage, { bigint: true })) ||
          !unchangedFile(after, await lstat(file, { bigint: true }))) throw locked();
    }
    return { text, stat: after, stage };
  } catch { throw locked(); }
}
async function removeMatching(file: string, expected: LockSnapshot): Promise<void> {
  const current = await snapshot(file);
  if (current && sameFile(current.stat, expected.stat) && current.text === expected.text) {
    await unlink(file);
    // Authoritative name first: a crash here leaves only an inert private stage.
    // Re-read identity/content after nlink changes; never glob-delete old stages.
    if (current.stage) await removeMatching(current.stage, current);
  }
}

/** Exclusive local writer. Kernel guard survives no process; disk metadata survives crashes. */
export async function acquireStoreLock(directory: string, runtime?: RuntimeIdentity): Promise<() => Promise<void>> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const closeGuard = await kernelGuard(directory);
  const file = path.join(directory, '.runtime.lock');
  const lockId = randomUUID();
  const stage = path.join(directory, `.runtime.lock.${lockId}.stage`);
  let handle: FileHandle | undefined;
  let staged: BigIntStats | undefined;
  const cleanStage = async () => {
    if (!staged) return;
    try {
      const current = await lstat(stage, { bigint: true });
      if (current.isFile() && !current.isSymbolicLink() && sameFile(current, staged) &&
          (current.nlink === 1n || current.nlink === 2n)) await unlink(stage);
    } catch (error) { if (codeOf(error) !== 'ENOENT') throw error; }
  };
  try {
    const previous = await snapshot(file);
    if (previous && !await definitelyDead(parseRecord(previous.text))) throw locked();
    // Attest self and sync complete private metadata before touching a stale owner.
    const ownerIdentity = await identityForSelf();
    const text = JSON.stringify({ pid: process.pid, kind: 'sidaksa-private-writer', ...runtime, lockId, ownerIdentity });
    try { handle = await open(stage, 'wx', 0o600); } catch { throw locked(); }
    // Use pathname stats consistently: Windows fstat.dev can differ from lstat.dev.
    staged = await lstat(stage, { bigint: true });
    await handle.writeFile(text);
    await handle.sync();
    await handle.close(); handle = undefined;
    const prepared = await snapshot(stage);
    if (!prepared || !sameFile(prepared.stat, staged) || prepared.text !== text) throw locked();
    if (previous) await removeMatching(file, previous);
    // Hard-link publication is atomic and fails if ANY destination already exists.
    // Never use overwrite-rename or a check-then-rename fallback.
    try { await link(stage, file); } catch { throw locked(); }
    await cleanStage();
    const owned = { text, stat: staged };
    let releasing: Promise<void> | undefined;
    return () => releasing ??= (async () => {
      // Keep the kernel guard through ownership-checked release (including ABA).
      try { await removeMatching(file, owned); }
      finally { await closeGuard(); }
    })();
  } catch (error) {
    try { await handle?.close(); }
    finally { try { await cleanStage(); } finally { await closeGuard(); } }
    throw error;
  }
}
