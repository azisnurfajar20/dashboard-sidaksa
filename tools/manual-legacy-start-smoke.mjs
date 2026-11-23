import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { syntheticWorkbook } from '../tests/domain/fixture.ts';
import { normalizeWorkbook, NORMALIZATION_REVISION } from '../server/domain/normalize.ts';

// Exact Windows owner command against synthetic legacy data, never the real cache/Excel.
assert.equal(process.platform, 'win32');
const root = process.cwd(), base = path.resolve('.private/test-tmp');
await mkdir(base, { recursive: true });
const directory = await mkdtemp(path.join(base, 'manual-legacy-smoke-'));
const reservation = createServer();
await new Promise((resolve, reject) => { reservation.once('error', reject); reservation.listen(0, '127.0.0.1', resolve); });
const port = reservation.address().port; assert.notEqual(port, 3080);
await new Promise(resolve => reservation.close(resolve));
const origin = `http://127.0.0.1:${port}`, file = path.join(directory, 'state.json');
const raw = syntheticWorkbook(), options = { referenceTabs: [], mappings: [] };
raw.sheets.find(s => s.name === 'Proses Rekrutment').rows[1].cells[2].value = 'Synthetic Unverified Name';
const snapshot = normalizeWorkbook(raw, options), currentId = snapshot.id;
const oldHash = createHash('sha256').update(JSON.stringify(raw)).digest('hex');
snapshot.id = 's_' + createHash('sha256').update(oldHash + JSON.stringify(options)).digest('hex').slice(0, 24);
delete snapshot.normalizationRevision;
const oldId = id => id.startsWith(currentId + ':') ? snapshot.id + id.slice(currentId.length) : id;
for (const row of snapshot.applications) {
  row.id = oldId(row.id);
  const matches = snapshot.candidates.filter(candidate => candidate.id === row.candidateId);
  row.candidateGraduationYear = matches.length === 1 ? matches[0].graduationYear : null;
  row.candidateCategory = matches.length === 1 ? matches[0].category : null;
}
for (const row of snapshot.departures) row.id = oldId(row.id);
for (const row of snapshot.issues) {
  row.id = oldId(row.id);
  if (['application', 'departure', 'reference', 'rejected-row'].includes(row.entityType)) row.entityId = oldId(row.entityId);
}
assert.equal(snapshot.applications[0].identityVerified, false);
assert.equal(snapshot.applications[0].candidateCategory, 'Program A');
const seed = { version: 1, raw, snapshot, settings: { referenceTabs: [], syncIntervalMinutes: 47, retentionDays: 91 },
  mappings: [], reviews: [{ snapshotId: snapshot.id, issueId: snapshot.issues[0].id, status: 'reviewed', note: 'Synthetic original review', at: raw.fetchedAt, by: 'synthetic-admin' }],
  audit: [{ id: 'synthetic-legacy-audit', at: raw.fetchedAt, actorId: 'synthetic-admin', action: 'synthetic.seed', result: 'ok', details: {} }],
  sync: { state: 'ok', lastAttemptAt: raw.fetchedAt, lastSuccessAt: raw.fetchedAt, nextRunAt: null, message: null } };
const original = structuredClone(seed), originalBytes = JSON.stringify(seed);
await writeFile(file, originalBytes); await writeFile(path.join(directory, '.npmrc'), '');
const env = { ...process.env, HOST: '127.0.0.1', PORT: String(port), APP_ORIGIN: origin, SIDAKSA_DATA_DIR: directory,
  SUPABASE_URL: '', SUPABASE_PUBLISHABLE_KEY: '', AUTH_GOOGLE_ENABLED: 'false', GOOGLE_SPREADSHEET_ID: '',
  GOOGLE_APPLICATION_CREDENTIALS: '', GOOGLE_USE_ADC: 'false', GOOGLE_REFERENCE_TABS: '[]', SYNC_INTERVAL_MINUTES: '15',
  SNAPSHOT_RETENTION_DAYS: '30', TEMP: directory, TMP: directory, TMPDIR: directory,
  NPM_CONFIG_CACHE: path.join(directory, 'npm-cache'), NPM_CONFIG_USERCONFIG: path.join(directory, '.npmrc') };
const children = [], report = { testedAt: new Date().toISOString(), command: 'npm run start', passed: false,
  operationalServerStarted: false, syntheticLegacyCacheOnly: true, isolatedPort: port, stage: 'legacy-cold-owner-command' };
function bounded(promise, milliseconds, code) {
  return new Promise((resolve, reject) => { const timer = setTimeout(() => reject(Object.assign(new Error(code), { code })), milliseconds);
    promise.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); }); });
}
function launch() {
  const child = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm run start'], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const item = { child, output: '', errors: '', exited: false, completion: null }; children.push(item);
  item.completion = new Promise(resolve => {
    child.once('exit', (code, signal) => { item.exited = true; resolve({ code, signal }); });
    child.once('error', error => { item.exited = true; resolve({ spawnError: true, code: error.code }); });
  });
  child.stdout.on('data', data => { item.output += data.toString(); }); child.stderr.on('data', data => { item.errors += data.toString(); });
  return item;
}
async function stop(item) {
  if (!item.exited) await new Promise((resolve, reject) => execFile('taskkill.exe', ['/PID', String(item.child.pid), '/T', '/F'],
    { timeout: 15000, windowsHide: true }, error => error && !item.exited ? reject(error) : resolve()));
  await bounded(item.completion, 10000, 'OWNED_TREE_EXIT_TIMEOUT');
}
async function ready(item) {
  await bounded(new Promise((resolve, reject) => {
    const check = () => { if (item.output.includes(`SIDAKSA tersedia di ${origin}`)) resolve(); };
    item.child.stdout.on('data', check); check();
    item.completion.then(() => reject(Object.assign(new Error('EXIT_BEFORE_READY'), { code: 'EXIT_BEFORE_READY' })));
  }), 20000, 'READINESS_TIMEOUT');
  assert.equal((await fetch(origin + '/api/health', { signal: AbortSignal.timeout(3000) })).status, 200);
}
try {
  const first = launch(); await ready(first); report.stage = 'legacy-cache-upgraded-and-backed-up';
  let current;
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    current = JSON.parse(await readFile(file, 'utf8'));
    if (current.snapshot?.normalizationRevision === NORMALIZATION_REVISION) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.equal(current.snapshot.normalizationRevision, NORMALIZATION_REVISION);
  assert.notEqual(current.snapshot.id, original.snapshot.id);
  assert.equal(current.snapshot.applications[0].candidateGraduationYear, null);
  assert.equal(current.snapshot.applications[0].candidateCategory, null);
  assert.deepEqual(current.raw, original.raw); assert.deepEqual(current.settings, original.settings);
  assert.deepEqual(current.mappings, original.mappings); assert.deepEqual(current.reviews, original.reviews);
  assert(current.audit.some(row => row.id === 'synthetic-legacy-audit'));
  const backups = await readdir(path.join(directory, 'compatibility')); assert.equal(backups.length, 1);
  const backup = JSON.parse(await readFile(path.join(directory, 'compatibility', backups[0]), 'utf8'));
  assert.equal(JSON.stringify(backup.state), originalBytes);
  assert.equal((await fetch(origin + '/api/overview', { signal: AbortSignal.timeout(3000) })).status, 401);
  const publicConfig = await (await fetch(origin + '/api/public-config', { signal: AbortSignal.timeout(3000) })).json();
  assert.equal(publicConfig.authConfigured, false);
  Object.assign(report, { passed: true, stage: 'verified', exactOwnerCommandOpenedLegacyCache: true,
    legacyRawSettingsMappingsReviewsPreserved: true, originalStateBackedUp: true, snapshotIdentityChanged: true,
    unverifiedDemographicsRemoved: true, anonymousHttp: 401, noFixtureLoginBypass: true });
} catch (error) {
  report.error = { name: error?.name || 'Error', code: error?.code || null, phase: report.stage };
  report.genericStartupMessageObserved = children.some(item => item.errors.includes('SIDAKSA tidak dapat dimulai.'));
  process.exitCode = 1;
} finally {
  for (const item of children) await stop(item);
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  await mkdir('.private/evidence', { recursive: true });
  await writeFile('.private/evidence/manual-legacy-start-smoke.json', JSON.stringify(report, null, 2));
}
console.log(JSON.stringify(report, null, 2));
