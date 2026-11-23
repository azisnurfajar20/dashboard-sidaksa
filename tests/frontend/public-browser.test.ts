import { expect, it } from 'vitest';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
it('boots the real production entry with honest unconfigured access, themed Bootstrap and no private fetches', async () => {
  const paths: string[] = [];
  const temp = path.resolve('.private/test-tmp/public-browser'); await mkdir(temp, { recursive: true });
  const server = await createServer({ configFile: false, envDir: false, root: process.cwd(), cacheDir: '.private/test-tmp/public-vite', server: { host: '127.0.0.1', port: 0, strictPort: false }, plugins: [{ name: 'public-config-only-test', configureServer(server) { server.middlewares.use((req, res, next) => { if (!req.url?.startsWith('/api/')) return next(); paths.push(req.url); if (req.url === '/api/public-config') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ appName: 'SIDAKSA', authConfigured: false, supabaseUrl: null, supabasePublishableKey: null, googleOAuthEnabled: false })); } else { res.statusCode = 401; res.end('{}'); } }); } }] });
  let browser;
  try {
    await server.listen(); browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, env: { ...process.env, TEMP: temp, TMP: temp, TMPDIR: temp } });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } }); const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(server.resolvedUrls!.local[0]); await page.getByTestId('auth-setup').waitFor({ timeout: 15000 });
    expect(await page.getByTestId('login-submit').isDisabled()).toBe(true); expect(await page.getByTestId('login-email').isDisabled()).toBe(true);
    expect(await page.getByTestId('login-google').count()).toBe(0);
    expect(paths).toEqual(['/api/public-config']); expect(errors).toEqual([]);
    expect(await page.getByTestId('login-submit').evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgb(6, 80, 155)');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await browser?.close(); await server.close(); }
}, 60000);
