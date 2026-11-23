import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { readConfig } from '../../server/config';
import { createApp } from '../../server/app';
import { ApiError, type Authenticator } from '../../server/auth';
import { createStore } from '../../server/store';
import { normalizeWorkbook } from '../../server/domain/normalize';
import { createSyncService } from '../../server/sync';
import { startServer, type RunningServer } from '../../server/index';
import { AUTH_URL, FIXTURE_URL, PUBLIC_URL, ROLES, TOKENS, USERS, SNAPSHOT_CONTROL_FILE, browserWorkbook } from './fixture-data';

export default async function globalSetup() {
  const base = path.resolve('.private/test-tmp');
  await mkdir(base, { recursive: true });
  await rm(SNAPSHOT_CONTROL_FILE, { force: true });
  const directory = await mkdtemp(path.join(base, 'browser-e2e-'));
  const temporary = path.join(directory, 'browser-temp');
  await mkdir(temporary);
  const previous = { TEMP: process.env.TEMP, TMP: process.env.TMP, TMPDIR: process.env.TMPDIR };
  Object.assign(process.env, { TEMP: temporary, TMP: temporary, TMPDIR: temporary });
  const running: RunningServer[] = [];
  const close = async () => {
    const errors: unknown[] = [];
    await rm(SNAPSHOT_CONTROL_FILE, { force: true });
    for (const server of [...running].reverse()) try { await server.close(); } catch (error) { errors.push(error); }
    for (const [key, value] of Object.entries(previous)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
    if (!errors.length) await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    if (errors.length) throw errors[0];
  };
  try {
    const config = { ...readConfig({ HOST: '127.0.0.1', PORT: '4181', APP_ORIGIN: FIXTURE_URL, SIDAKSA_DATA_DIR: path.join(directory, 'fixture-store'), SUPABASE_URL: AUTH_URL, SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_isolated_browser_test', GOOGLE_SPREADSHEET_ID: 'SYNTHETIC-UNIT-ONLY', GOOGLE_REFERENCE_TABS: '["Crew List Departure","Funnel Rekap"]' }), sheetsConfigured: true, credentialConfigured: true };
    const references = ['Crew List Departure', 'Funnel Rekap'];
    const store = await createStore({ directory: config.dataDir, settings: { referenceTabs: references } });
    const raw = browserWorkbook();
    await store.publish(raw, normalizeWorkbook(raw, { referenceTabs: references, mappings: [] }));
    const authenticator: Authenticator = async token => {
      const role = ROLES.find(value => TOKENS[value] === token);
      if (!role) throw new ApiError(401, 'INVALID_TOKEN', 'Sesi uji tidak valid.');
      return USERS[role];
    };
    let reads = 0;
    const sync = createSyncService({ store, allowFixtureForTests: true, loader: async () => {
      let revision = 0;
      try { revision = JSON.parse(await readFile(SNAPSHOT_CONTROL_FILE, 'utf8')).revision; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      if (Number.isInteger(revision) && revision > 0 && revision <= 3) {
        const changed = browserWorkbook(), tab = changed.sheets.find(sheet => sheet.name === 'Proses Rekrutment')!;
        for (let index = 0; index < revision; index++) tab.rows.push({ ...structuredClone(tab.rows[2]!), rowNumber: 5 + index });
        return changed;
      }
      reads++;
      if (reads > 1) throw new ApiError(503, 'SOURCE_UNAVAILABLE', 'Gangguan sumber sintetis untuk pengujian retensi snapshot.');
      return browserWorkbook();
    } });
    const app = await createApp({ config, store, authenticator, sync, allowFixtureForTests: true });
    const fixture = await startServer({ config, app }); running.push(fixture); await fixture.ready;
    const publicConfig = readConfig({ HOST: '127.0.0.1', PORT: '4180', APP_ORIGIN: PUBLIC_URL, SIDAKSA_DATA_DIR: path.join(directory, 'unconfigured-store') });
    const publicServer = await startServer({ config: publicConfig }); running.push(publicServer); await publicServer.ready;
    console.log('E2E: isolated synthetic fixture and unconfigured servers started; no live credentials loaded.');
    return close;
  } catch (error) {
    await close();
    throw error;
  }
}
