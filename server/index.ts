import express, { type ErrorRequestHandler } from 'express';
import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { acquireStoreLock, assertPrivateStoreLocation, createApp, type SidaksaApp } from './app.js';
import { readConfig, type Config } from './config.js';

export interface StartOptions { config: Config; projectRoot?: string; development?: boolean; app?: SidaksaApp }
export interface RunningServer { app: SidaksaApp; server: Server; url: string; ready: Promise<void>; close(): Promise<void> }
async function assertPublicTree(directory: string): Promise<void> {
  if ((await lstat(directory)).isSymbolicLink()) throw new Error('Public build may not contain links');
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error('Public build may not contain links');
    if (entry.isDirectory()) await assertPublicTree(path.join(directory, entry.name));
  }
}
function forbiddenPath(value: string): boolean {
  let decoded = value.split('?')[0]!;
  try { for (let i = 0; i < 3; i++) { const next = decodeURIComponent(decoded); if (next === decoded) break; decoded = next; } } catch { return true; }
  decoded = decoded.replace(/\\/g, '/').toLocaleLowerCase('en-US');
  const parts = decoded.split('/');
  return parts.some(p => p.startsWith('.') || p.includes(':')) || /^\/(?:server|docs|tests|tools|node_modules|shared|@fs)(?:\/|$)/.test(decoded);
}

export async function startServer(options: StartOptions): Promise<RunningServer> {
  const root = path.resolve(options.projectRoot || process.cwd());
  await assertPrivateStoreLocation(options.config.dataDir, root);
  if (options.app) await assertPrivateStoreLocation(options.app.locals.sidaksa.store.directory, root);
  const instanceId = randomUUID();
  const releaseLock = await acquireStoreLock(options.app?.locals.sidaksa.store.directory || options.config.dataDir, { instanceId, mode: options.development ? 'development' : 'production' });
  let stopFrontend: () => Promise<void> = async () => {};
  try {
  const app = options.app || await createApp({ config: options.config, development: options.development });
  app.locals.sidaksa.runtimeId = instanceId;
  const server = createServer(app);
  server.requestTimeout = 60000;
  server.headersTimeout = 15000;
  server.keepAliveTimeout = 5000;
  server.maxRequestsPerSocket = 1000;
  if (options.development) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({ root, server: { middlewareMode: true, hmr: { server }, fs: { strict: true, allow: [root], deny: ['**/.env', '**/.env.*', '**/*.{crt,pem,key}', '**/.git/**', root.replace(/\\/g, '/') + '/.private/**', root.replace(/\\/g, '/') + '/server/**'] } }, appType: 'spa' });
    stopFrontend = () => vite.close();
    app.use((req, res, next) => {
      const requestPath = req.url.split('?')[0]!;
      const isDependency = /^\/node_modules\/(?:[^.][^/]*\/|\.vite\/)/.test(requestPath);
      const blocked = isDependency ? /(?:^|\/)(?:\.env[^/]*|\.private|\.git)(?:\/|$)/i.test(requestPath) : forbiddenPath(req.url);
      if (blocked || path.extname(requestPath) && !/^\/(?:web|node_modules|@vite|@id)\//.test(requestPath) && requestPath !== '/index.html') { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Halaman tidak ditemukan.' } }); return; }
      next();
    });
    app.use(vite.middlewares);
  } else {
    const client = path.join(root, 'dist/client'), indexFile = path.join(client, 'index.html');
    try { if (!(await lstat(indexFile)).isFile()) throw new Error(); await readFile(indexFile); }
    catch { throw new Error('Build frontend belum tersedia. Jalankan npm run build.'); }
    await assertPublicTree(client);
    app.use((req, res, next) => {
      if (forbiddenPath(req.url)) { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Halaman tidak ditemukan.' } }); return; }
      next();
    });
    app.use(express.static(client, { dotfiles: 'deny', index: false, redirect: false, etag: false, setHeaders: (res, file) => { res.setHeader('Cache-Control', file.endsWith('.html') ? 'no-store' : 'public, max-age=3600'); } }));
    app.use((req, res, next) => {
      if (!['GET', 'HEAD'].includes(req.method) || !req.accepts('html') || path.extname(req.path)) { next(); return; }
      res.setHeader('Cache-Control', 'no-store'); res.sendFile('index.html', { root: client, dotfiles: 'deny' });
    });
  }
  app.use((_req, res) => { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Halaman tidak ditemukan.' } }); });
  const staticError: ErrorRequestHandler = (_error, _req, res, _next) => { if (!res.headersSent) res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Halaman tidak dapat dimuat.' } }); };
  app.use(staticError);
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(options.config.port, options.config.host, () => { server.off('error', reject); resolve(); }); });
  } catch (error) { throw error; }
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Listener tidak tersedia.');
  const host = address.family === 'IPv6' ? `[${address.address}]` : address.address;
  let closing: Promise<void> | undefined;
  const ready = app.locals.sidaksa.sync.start();
  return { app, server, url: `http://${host}:${address.port}`, ready,
    close() {
      closing ||= (async () => {
        const failures: unknown[] = [];
        try { await app.locals.sidaksa.sync.stop(); } catch (error) { failures.push(error); }
        try { await stopFrontend(); } catch (error) { failures.push(error); }
        try { await new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeIdleConnections(); }); } catch (error) { failures.push(error); }
        if (!server.listening) await releaseLock();
        if (failures.length) throw failures[0];
      })();
      return closing;
    },
  };
  } catch (error) { await stopFrontend(); await releaseLock(); throw error; }
}

export type StartupResult = { alreadyRunning: false; url: string; running: RunningServer } | { alreadyRunning: true; url: string; running?: undefined };

/** Only reuse the instance whose opaque identity matches this exact private lock. */
export async function startOrReuseServer(options: StartOptions): Promise<StartupResult> {
  try {
    const running = await startServer(options);
    return { alreadyRunning: false, url: running.url, running };
  } catch (error) {
    if ((error as { code?: string }).code !== 'STORE_LOCKED') throw error;
    const existing = await matchingActiveInstance(options);
    if (!existing) throw error;
    return { alreadyRunning: true, url: existing };
  }
}

async function matchingActiveInstance(options: StartOptions): Promise<string | undefined> {
  try {
    const directory = options.app?.locals.sidaksa.store.directory || options.config.dataDir;
    const file = path.join(directory, '.runtime.lock'), info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 4096) return;
    const lock = JSON.parse(await readFile(file, 'utf8'));
    if (lock.kind !== 'sidaksa-private-writer' || !Number.isSafeInteger(lock.pid) || lock.pid < 1 ||
        typeof lock.instanceId !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(lock.instanceId) ||
        lock.mode !== (options.development ? 'development' : 'production')) return;
    process.kill(lock.pid, 0); // Presence only; never signal or replace an active writer.
    const host = options.config.host;
    const localHost = ['127.0.0.1', '0.0.0.0'].includes(host) ? '127.0.0.1' : ['::', '::1'].includes(host) ? '[::1]' : host === 'localhost' ? 'localhost' : undefined;
    if (!localHost || !Number.isInteger(options.config.port) || options.config.port < 1 || options.config.port > 65535) return;
    const url = `http://${localHost}:${options.config.port}`;
    const response = await fetch(url + '/api/health', { signal: AbortSignal.timeout(2000), redirect: 'error' });
    if (response.status !== 200 || response.headers.get('X-Sidaksa-Instance') !== lock.instanceId) return;
    const body = await response.json();
    if (body.status === 'ok') return url;
  } catch { /* Legacy, stale or unverifiable locks remain fail-closed. */ }
}

export function startupErrorMessage(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  if (code === 'STORE_INVALID') return 'SIDAKSA belum dapat dimulai: Integritas atau kompatibilitas cache/snapshot privat belum dapat diverifikasi. Jangan hapus cache atau mengubah data Excel/Google Sheets. Periksa versi build dan cadangan penyimpanan privat.';
  if (code === 'STORE_LOCKED') return 'SIDAKSA belum dapat dimulai: Penyimpanan privat sedang dipakai atau memiliki lock yang belum dapat diverifikasi. Jangan hapus lock proses aktif. Periksa server yang sedang berjalan; server versi lama perlu dihentikan sebelum memakai build baru.';
  if (code === 'EADDRINUSE') return 'SIDAKSA belum dapat dimulai: Port sudah dipakai proses lain. Hentikan hanya server SIDAKSA yang Anda kenali atau pilih port lain; data dan proses lain tidak diubah.';
  return 'SIDAKSA tidak dapat dimulai. Periksa konfigurasi, izin penyimpanan privat, dan hasil build. Nilai rahasia tidak dicetak.';
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  dotenv.config({ quiet: true });
  try {
    const result = await startOrReuseServer({ config: readConfig(), development: process.argv.includes('--dev') });
    if (result.alreadyRunning) {
      console.log(`SIDAKSA sudah berjalan di ${result.url}. Gunakan server aktif; tidak ada server kedua yang dimulai. Perubahan konfigurasi memerlukan restart server aktif.`);
    } else {
      const running = result.running;
      console.log(`SIDAKSA tersedia di ${running.url}`);
      void running.ready.catch(() => { console.error('Penjadwal sinkronisasi tidak dapat dimulai.'); });
      const shutdown = () => { void running.close().catch(() => { process.exitCode = 1; }); };
      process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
    }
  } catch (error) { console.error(startupErrorMessage(error)); process.exitCode = 1; }
}
