import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { startServer } from '../dist/server/index.js';
import { readConfig } from '../server/config.ts';
import { probeEntrypoint } from './entrypoint-smoke.mjs';

const root = process.cwd();
const base = path.resolve('.private/test-tmp');
await mkdir(base, { recursive: true });
const directory = await mkdtemp(path.join(base, 'compiled-smoke-'));
const environment = { ...process.env, TEMP: directory, TMP: directory, TMPDIR: directory, HOST: '127.0.0.1', PORT: '3080', APP_ORIGIN: 'http://127.0.0.1:3080', SIDAKSA_DATA_DIR: directory,
  SUPABASE_URL: '', SUPABASE_PUBLISHABLE_KEY: '', AUTH_GOOGLE_ENABLED: 'false', GOOGLE_SPREADSHEET_ID: '', GOOGLE_APPLICATION_CREDENTIALS: '', GOOGLE_USE_ADC: 'false', GOOGLE_REFERENCE_TABS: '[]', SYNC_INTERVAL_MINUTES: '15', SNAPSHOT_RETENTION_DAYS: '30' };
let running;
try {
  running = await startServer({ config: { ...readConfig(environment), port: 0 }, projectRoot: root });
  await running.ready;
  const statuses = {};
  for (const [name, url, expected] of [
    ['health', '/api/health', 200], ['anonymous', '/api/overview', 401],
    ['environment-file', '/.env', 404], ['private-cache', '/.private/data/state.json', 404],
    ['encoded-private', '/%252eprivate/data/state.json', 404], ['filesystem-path', '/@fs/D:/sidaksa/.private/fixtures/source.json', 404],
    ['backend-source', '/server/auth.ts', 404],
  ]) {
    const response = await fetch(running.url + url); statuses[name] = response.status; assert.equal(response.status, expected);
  }
  const denied = await fetch(running.url + '/api/me', { headers: { Authorization: 'Bearer FICTITIOUS_INVALID_TOKEN' } });
  assert.equal(denied.status, 503); assert.equal((await denied.json()).error.code, 'AUTH_UNCONFIGURED');
  const config = await (await fetch(running.url + '/api/public-config')).json();
  assert.equal(config.authConfigured, false); assert.equal(config.supabasePublishableKey, null);
  const page = await fetch(running.url + '/'); const html = await page.text();
  assert.equal(page.status, 200); assert(html.includes('id="root"'));
  const asset = html.match(/src="(\/assets\/[^\"]+\.js)"/);
  assert(asset); assert.equal((await fetch(running.url + asset[1])).status, 200);
  await running.close(); running = undefined;
  assert.equal(await readFile(path.join(directory, '.runtime.lock'), 'utf8').catch(error => error.code === 'ENOENT' ? null : Promise.reject(error)), null);
  const backup = path.join(directory, 'verified-backup.json');
  const runCli = args => {
    const result = spawnSync(process.execPath, ['--import', 'tsx', 'server/cli.ts', ...args], { cwd: root, env: environment, encoding: 'utf8', timeout: 30000 });
    assert.equal(result.status, 0, result.stdout + result.stderr); return JSON.parse(result.stdout.trim());
  };
  assert.equal(runCli(['backup', backup]).status, 'ok');
  await writeFile(path.join(directory, 'state.json'), 'FICTITIOUS CORRUPT CACHE FOR ISOLATED RESTORE TEST');
  assert.equal(runCli(['restore', backup]).status, 'ok');
  const restored = JSON.parse(await readFile(path.join(directory, 'state.json'), 'utf8'));
  assert.equal(restored.version, 1); assert.equal(restored.snapshot, null);
  assert.equal(restored.audit.at(-1).action, 'backup.restore');
  const directCliEntrypoint = await probeEntrypoint(root, path.join(directory, 'direct-entry'), environment);
  const result = { testedAt: new Date().toISOString(), compiledEntry: 'dist/server/index.js', directCliEntrypoint, liveIntegration: false,
    publicConfiguration: 'unconfigured-fail-closed', statuses, unconfiguredAuthenticatedRequest: 503, spa: 200, publicAsset: 200,
    runtimeLockReleased: true, actualCliBackup: 'passed', actualCliCorruptCacheRestore: 'passed' };
  await mkdir('.private/evidence', { recursive: true });
  await writeFile('.private/evidence/production-smoke.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  if (running) await running.close();
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
