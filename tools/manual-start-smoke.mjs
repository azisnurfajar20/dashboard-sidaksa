import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Owner-facing command exercised only on an isolated port/store. Never operational3080.
assert.equal(process.platform, 'win32', 'This smoke exercises the Windows owner command.');
await mkdir('.private/test-tmp', { recursive: true });
const root = process.cwd(), directory = await mkdtemp(path.resolve('.private/test-tmp/manual-start-smoke-'));
await writeFile(path.join(directory, '.npmrc'), '');
const reservation = createServer(); await new Promise((resolve, reject) => { reservation.once('error', reject); reservation.listen(0, '127.0.0.1', resolve); });
const port = reservation.address().port; assert.notEqual(port, 3080);
await new Promise(resolve => reservation.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const env = { ...process.env, HOST: '127.0.0.1', PORT: String(port), APP_ORIGIN: origin, SIDAKSA_DATA_DIR: directory,
  SUPABASE_URL: '', SUPABASE_PUBLISHABLE_KEY: '', AUTH_GOOGLE_ENABLED: 'false', GOOGLE_SPREADSHEET_ID: '',
  GOOGLE_APPLICATION_CREDENTIALS: '', GOOGLE_USE_ADC: 'false', GOOGLE_REFERENCE_TABS: '[]', SYNC_INTERVAL_MINUTES: '15',
  SNAPSHOT_RETENTION_DAYS: '30', TEMP: directory, TMP: directory, TMPDIR: directory,
  NPM_CONFIG_CACHE: path.join(directory, 'npm-cache'), NPM_CONFIG_USERCONFIG: path.join(directory, '.npmrc') };
const children = [];
const report = { testedAt: new Date().toISOString(), command: 'npm run start', operationalServerStarted: false, isolatedPort: port,
  syntheticUnconfiguredEnvironment: true, passed: false, stage: 'cold-command-start' };
function launch() {
  const child = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm run start'], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const item = { child, output: '', exited: false, completion: null }; children.push(item);
  item.completion = new Promise(resolve => child.once('exit', (code, signal) => { item.exited = true; resolve({ code, signal }); }));
  child.stdout.on('data', chunk => { item.output += chunk.toString(); }); child.stderr.on('data', () => {});
  return item;
}
async function ready(item) {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('MANUAL_COMMAND_READINESS_TIMEOUT')), 20000);
    item.child.stdout.on('data', () => { if (item.output.includes(`SIDAKSA tersedia di ${origin}`)) { clearTimeout(timer); resolve(); } });
    item.child.once('error', error => { clearTimeout(timer); reject(error); });
    item.completion.then(() => { clearTimeout(timer); reject(new Error('MANUAL_COMMAND_EXIT_BEFORE_READY')); });
  });
  assert.equal((await fetch(origin + '/api/health')).status, 200);
}
async function stopTree(item) {
  if (!item.exited) await new Promise((resolve, reject) => {
    execFile('taskkill.exe', ['/PID', String(item.child.pid), '/T', '/F'], { timeout: 15000, windowsHide: true }, error => error && !item.exited ? reject(error) : resolve());
  });
  await item.completion;
}
try {
  const first = launch(); await ready(first);
  const lockPath = path.join(directory, '.runtime.lock'), before = await readFile(lockPath, 'utf8');
  report.coldManualCommandStarted = true; report.stage = 'warm-duplicate-command';
  const duplicate = launch();
  const duplicateExit = await Promise.race([duplicate.completion, new Promise((_, reject) => { const t = setTimeout(() => reject(new Error('DUPLICATE_COMMAND_TIMEOUT')), 15000); t.unref(); })]);
  assert.equal(duplicateExit.code, 0); assert(duplicate.output.includes(`SIDAKSA sudah berjalan di ${origin}`));
  assert.equal(await readFile(lockPath, 'utf8'), before); report.warmDuplicateExit = 0;
  report.stage = 'forced-console-tree-exit'; await stopTree(first);
  assert.equal(await readFile(lockPath, 'utf8'), before);
  report.staleLockActuallyRemained = true; report.stage = 'manual-restart-after-abnormal-exit';
  const restarted = launch(); await ready(restarted);
  assert.notEqual(JSON.parse(await readFile(lockPath, 'utf8')).instanceId, JSON.parse(before).instanceId);
  assert.equal((await fetch(origin + '/api/overview')).status, 401);
  Object.assign(report, { passed: true, stage: 'verified', exactOwnerCommandRestartsWithoutManualCleanup: true,
    healthHttp: 200, anonymousHttp: 401, noCredentialBypass: true });
} catch (error) { report.error = { name: error?.name || 'ERROR', code: error?.code || null, phase: report.stage }; process.exitCode = 1; }
finally {
  for (const child of children) await stopTree(child);
  await rm(directory, { recursive: true, force: true });
  await writeFile('.private/evidence/manual-start-smoke.json', JSON.stringify(report, null, 2));
}
console.log(JSON.stringify(report, null, 2));
