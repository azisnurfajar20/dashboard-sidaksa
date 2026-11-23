import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { lstat, mkdir, mkdtemp, open, readFile, rename, rm, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { readConfig } from './config.js';
import { REQUIRED_TABS } from './domain/normalize.js';
import { createStore } from './store.js';
import { acquireStoreLock, assertPrivateStoreLocation } from './app.js';
import { ApiError } from './auth.js';

const within = (file: string, root: string) => { const relative = path.relative(root, file); return relative !== '' && !relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative); };
async function privateTarget(value: string, root: string, dataDir: string): Promise<string> {
  const file = path.resolve(root, value);
  if (!file.endsWith('.json') || ![path.join(root, '.private'), dataDir].some(p => within(file, p)) || [path.join(root, 'dist'), path.join(root, 'web'), path.join(root, 'public')].some(p => within(file, p)) || file === path.join(dataDir, 'state.json')) throw new Error('Private target required');
  // Refuse links/junctions rather than following a private-looking path into public assets.
  for (let current = file; path.dirname(current) !== current; current = path.dirname(current)) {
    try { if ((await lstat(current)).isSymbolicLink()) throw new Error('Links not allowed'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  return file;
}

export interface CliOptions {
  env?: NodeJS.ProcessEnv;
  projectRoot?: string;
  write?: (line: string) => void;
  /** Isolated in-process tests only; no CLI flag or environment equivalent exists. */
  allowFixtureForTests?: boolean;
}
export async function runCli(args: string[], options: CliOptions = {}): Promise<number> {
  const write = options.write || console.log;
  try {
    const command = args[0];
    if (command !== 'check' && command !== 'backup' && command !== 'restore' || command === 'check' && args.length !== 1 || command !== 'check' && args.length !== 2) { write(JSON.stringify({ error: { code: 'USAGE', message: 'Gunakan: tsx server/cli.ts check | backup <path> | restore <path>. Simpan file JSON di .private/. Hentikan server sebelum restore.' } })); return 1; }
    const root = path.resolve(options.projectRoot || process.cwd()), env = { ...(options.env || process.env) };
    env.SIDAKSA_DATA_DIR = path.resolve(root, env.SIDAKSA_DATA_DIR || '.private/data');
    const config = readConfig(env);
    if (command === 'check') {
      const configured = config.authConfigured && config.sheetsConfigured;
      write(JSON.stringify({ check: 'configuration-only', configured, authConfigured: config.authConfigured, sheetsConfigured: config.sheetsConfigured, credentialConfigured: config.credentialConfigured, requiredTabs: REQUIRED_TABS, referenceTabs: config.referenceTabs, syncIntervalMinutes: config.syncIntervalMinutes, retentionDays: config.retentionDays, message: configured ? 'Konfigurasi tersedia; koneksi live belum diverifikasi oleh pemeriksaan ini.' : 'Konfigurasi belum lengkap; Supabase Auth dan Google Sheets perlu disiapkan.' }));
      return configured ? 0 : 2;
    }
    await assertPrivateStoreLocation(config.dataDir, root);
    const file = await privateTarget(args[1]!, root, config.dataDir);
    if (command === 'restore') {
      if ((await stat(file)).size > 100 * 1024 * 1024) throw new Error('Backup bounds');
      const envelope = JSON.parse(await readFile(file, 'utf8'));
      if (!options.allowFixtureForTests && (envelope.state?.raw?.source === 'fixture' || envelope.state?.snapshot?.source === 'fixture')) throw new Error('Production fixture restoration refused');
    }
    if (command === 'restore') {
      const releaseLock = await acquireStoreLock(config.dataDir);
      try {
      // Validate in a separate store so even an unreadable active cache can be recovered.
      const scratch = path.join(root, '.private/test-tmp'); await mkdir(scratch, { recursive: true, mode: 0o700 });
      const staging = await mkdtemp(path.join(scratch, 'restore-'));
      const temp = path.join(config.dataDir, `state.restore-${randomUUID()}.tmp`);
      try {
        const checked = await createStore({ directory: staging }); await checked.restore(file);
        const contents = await readFile(path.join(staging, 'state.json'));
        await mkdir(config.dataDir, { recursive: true, mode: 0o700 });
        const handle = await open(temp, 'wx', 0o600);
        try { await handle.writeFile(contents); await handle.sync(); } finally { await handle.close(); }
        await rename(temp, path.join(config.dataDir, 'state.json'));
      } finally { await rm(temp, { force: true }); await rm(staging, { recursive: true, force: true }); }
      } finally { await releaseLock(); }
    }
    const store = await createStore({ directory: config.dataDir, settings: { referenceTabs: config.referenceTabs, syncIntervalMinutes: config.syncIntervalMinutes, retentionDays: config.retentionDays } });
    if (command === 'backup') await store.backup(file);
    const snapshot = store.read().snapshot;
    write(JSON.stringify({ operation: command, status: 'ok', snapshotId: snapshot?.id || null, source: snapshot?.source || null }));
    return 0;
  } catch (error) { write(JSON.stringify({ error: error instanceof ApiError && error.code === 'STORE_LOCKED' ? { code: error.code, message: error.message } : { code: 'CLI_FAILED', message: 'Perintah gagal. Periksa konfigurasi dan penyimpanan privat; detail rahasia tidak ditampilkan.' } })); return 1; }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  dotenv.config({ quiet: true });
  process.exitCode = await runCli(process.argv.slice(2));
}
