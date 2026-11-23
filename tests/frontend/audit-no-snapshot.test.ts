import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { settings, status, options } from './fixture';

let vite: ViteDevServer, browser: Browser, base: string;
const requests: string[] = [];
const auth = `import { ApiClient } from '/web/lib/api';
const me={user:{id:'audit-admin',email:'audit@example.invalid',role:'admin'},permissions:{manageData:true,viewContact:true,exportDetail:true}};
const value={session:{phase:'authorized',me,token:'ISOLATED_AUDIT_TOKEN'},api:new ApiClient(()=> 'ISOLATED_AUDIT_TOKEN',()=>{}),logout:async()=>{}};
export const useAuth=()=>value;export const AuthProvider=({children})=>children;export const ProtectedApp=({children})=>children;`;
beforeAll(async () => {
  const temp = path.resolve('.private/test-tmp/audit-no-snapshot'); await mkdir(temp, { recursive: true });
  const envDir = path.join(temp, 'empty-env'); await mkdir(envDir, { recursive: true });
  vite = await createServer({ configFile: false, envDir, cacheDir: path.join(temp, 'vite'), root: process.cwd(), server: { host: '127.0.0.1', port: 0 },
    plugins: [{ name: 'audit-independent-source-fixture', enforce: 'pre', resolveId(id, importer) {
      if (importer?.replaceAll('\\', '/').includes('/web/') && /(?:^|\/)auth\/AuthProvider$/.test(id)) return '\0audit-no-snapshot-auth';
    }, load(id) { if (id === '\0audit-no-snapshot-auth') return auth; }, configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/api/')) { if (req.headers.accept?.includes('text/html')) req.url = '/tests/frontend/browser.html'; return next(); }
        requests.push(req.url); const url = new URL(req.url, 'http://isolated.invalid'); let result: unknown;
        if (url.pathname === '/api/status') result = { ...status, snapshot: null, sync: { ...status.sync, state: 'failed', lastSuccessAt: null } };
        else if (url.pathname === '/api/dictionaries') result = options;
        else if (url.pathname === '/api/settings') result = { ...settings, sheetsConfigured: false };
        else if (url.pathname === '/api/mappings') result = { rows: [] };
        else if (url.pathname === '/api/audit') {
          const row = { id: 'audit:first-failed', at: '2026-11-19T00:00:00.000Z', actorId: 'audit-admin', action: 'sync.refresh', result: 'failed', details: { reason: 'synthetic_source_offline' } };
          const q = url.searchParams.get('q') || '', rows = row.action.includes(q) ? [row] : [];
          result = { rows, pagination: { page: 1, limit: 10, total: rows.length, totalPages: rows.length ? 1 : 0 },
            meta: { kind: 'audit', generatedAt: '2026-11-19T00:00:00.000Z', filters: q ? { q } : {}, sourceSnapshot: null } };
        } else { res.statusCode = 404; result = { error: { code: 'NOT_FOUND' } }; }
        res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(result));
      });
    } }] });
  await vite.listen(); base = vite.resolvedUrls!.local[0]; expect(new URL(base).port).not.toBe('3080');
  browser = await chromium.launch({ channel: 'chrome', headless: true, env: { ...process.env, TEMP: temp, TMP: temp, TMPDIR: temp } });
}, 60000);
afterAll(async () => { await browser?.close(); await vite?.close(); });
describe('administrative audit independent of recruitment snapshot', () => {
  it('fetches and renders failed-first-sync audit with honest metadata before any snapshot succeeds', async () => {
    const context = await browser.newContext(), page = await context.newPage(); const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.name));
    try {
      await page.goto(new URL('/pengaturan', base).href); await page.locator('#audit').waitFor();
      await expect.poll(() => requests.some(request => request.startsWith('/api/audit?')), { timeout: 2500 }).toBe(true);
      await page.locator('#audit').getByText('sync.refresh', { exact: true }).waitFor();
      expect(await page.locator('#audit').textContent()).toContain('synthetic_source_offline');
      expect(await page.locator('#audit').textContent()).toContain('Belum tersedia');
      expect(await page.locator('#audit').getByTestId('state-setup').count()).toBe(0);
      expect(await page.locator('#audit').getByTestId('state-error').count()).toBe(0);
      expect(errors).toEqual([]);
    } finally { await context.close(); }
  }, 30000);
});
