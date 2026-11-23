import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd(), children = [];
await mkdir('.private/test-tmp', { recursive: true });
const directory = await mkdtemp(path.resolve('.private/test-tmp/crash-recovery-smoke-'));
const reservation = createServer();
await new Promise((resolve, reject) => { reservation.once('error', reject); reservation.listen(0, '127.0.0.1', resolve); });
const port = reservation.address().port;
await new Promise(resolve => reservation.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const env = { ...process.env, HOST: '127.0.0.1', PORT: String(port), APP_ORIGIN: origin, SIDAKSA_DATA_DIR: directory,
  SUPABASE_URL: '', SUPABASE_PUBLISHABLE_KEY: '', AUTH_GOOGLE_ENABLED: 'false', GOOGLE_SPREADSHEET_ID: '',
  GOOGLE_APPLICATION_CREDENTIALS: '', GOOGLE_USE_ADC: 'false', GOOGLE_REFERENCE_TABS: '[]', SYNC_INTERVAL_MINUTES: '15',
  SNAPSHOT_RETENTION_DAYS: '30', TEMP: directory, TMP: directory, TMPDIR: directory };
const report = { testedAt: new Date().toISOString(), passed: false, actualChildProcesses: true, syntheticUnconfiguredEnvironment: true, stage: 'first-start' };
async function boot() {
  const process = spawn(globalThis.process.execPath, [path.join(root, 'dist/server/index.js')], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const record = { process, exited: false, output: '', completion: null }; children.push(record);
  record.completion = new Promise(resolve => process.once('exit', (code, signal) => { record.exited = true; resolve({ code, signal }); }));
  process.stderr.on('data', () => {});
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('CHILD_START_TIMEOUT')), 20000);
    process.stdout.on('data', chunk => { record.output += chunk.toString(); if (record.output.includes(`SIDAKSA tersedia di ${origin}`)) { clearTimeout(timer); resolve(); } });
    process.once('error', error => { clearTimeout(timer); reject(error); });
    record.completion.then(result => { clearTimeout(timer); reject(new Error(`CHILD_EXIT_BEFORE_READY_${result.code}`)); });
  });
  assert.equal((await fetch(origin + '/api/health')).status, 200);
  return record;
}
try {
  const first = await boot(); report.firstStarted = true;
  const lockPath = path.join(directory, '.runtime.lock');
  const firstLock = JSON.parse(await readFile(lockPath, 'utf8'));
  assert.equal(firstLock.pid, first.process.pid);
  report.stage = 'forced-process-exit';
  first.process.kill('SIGKILL'); await first.completion;
  assert.equal(JSON.parse(await readFile(lockPath, 'utf8')).pid, firstLock.pid);
  report.staleLockActuallyRemained = true;
  report.stage = 'automatic-restart-without-manual-lock-delete';
  const second = await boot();
  const secondLock = JSON.parse(await readFile(lockPath, 'utf8'));
  assert.equal(secondLock.pid, second.process.pid);
  assert.notEqual(secondLock.instanceId, firstLock.instanceId);
  assert.equal((await fetch(origin + '/api/overview')).status, 401);
  const config = await (await fetch(origin + '/api/public-config')).json(); assert.equal(config.authConfigured, false);
  Object.assign(report, { passed: true, stage: 'verified', automaticallyRecoveredAfterRealForcedExit: true, newInstanceOwnsLock: true,
    healthHttp: 200, anonymousApiHttp: 401, noFixtureLoginBypass: true });
} catch (error) {
  report.error = { name: error?.name || 'ERROR', code: error?.code || null, phase: report.stage };
  process.exitCode = 1;
} finally {
  for (const child of children) { if (!child.exited) child.process.kill('SIGKILL'); await child.completion; }
  await rm(directory, { recursive: true, force: true });
  await writeFile('.private/evidence/crash-recovery-smoke.json', JSON.stringify(report, null, 2));
}
console.log(JSON.stringify(report, null, 2));
