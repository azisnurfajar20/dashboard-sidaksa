// Permanent FE-04 regression adapted from the independent final review probe.
// Real AuthProvider/ProtectedApp/AppRoutes; only SDK/network boundaries are synthetic.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
let browser: Browser; let context: BrowserContext; let page: Page; let bundle: string;
const errors: string[] = [];
const sdk = `export function createClient(){let token='SYNTHETIC_ACCESS_A';const listeners=new Set();const emit=(event,next)=>{token=next;for(const cb of listeners)cb(event,token?{access_token:token}:null)};globalThis.__emitSyntheticAuth=emit;return {auth:{onAuthStateChange(cb){listeners.add(cb);return {data:{subscription:{unsubscribe(){listeners.delete(cb)}}}}},async getSession(){return {data:{session:token?{access_token:token}:null},error:null}},stopAutoRefresh(){},async signOut(){globalThis.__syntheticSignOuts=(globalThis.__syntheticSignOuts||0)+1;emit('SIGNED_OUT',null);return {error:null}}}}}`;
beforeAll(async () => {
  const temp = resolve('.private/test-tmp/auth-generation-browser'); mkdirSync(temp, { recursive: true });
  const result = await build({ entryPoints: ['tests/frontend/verified-findings.entry.tsx'], bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' }, plugins: [{ name: 'synthetic-sdk-only', setup(build) { build.onResolve({ filter: /^@supabase\/supabase-js$/ }, () => ({ path: 'sdk', namespace: 'fixture' })); build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: sdk, loader: 'ts' })); } }] });
  bundle = result.outputFiles[0]!.text.replaceAll('</script', '<\\/script');
  browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--disable-gpu'], env: { ...process.env, TEMP: temp, TMP: temp, TMPDIR: temp } });
}, 60000);
beforeEach(async () => {
  errors.length = 0; context = await browser.newContext(); page = await context.newPage(); page.setDefaultTimeout(5000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  // No listener or live service: every navigation is fulfilled in memory, all other network is blocked.
  await context.route('**/*', route => route.request().isNavigationRequest() ? route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body><div id="root"></div><script>' + bundle + '</script></body></html>' }) : route.abort());
  await page.goto('http://sidaksa-auth-generation.invalid/rekrutmen?snapshotId=synthetic-A');
  await page.getByTestId('data-row').first().waitFor();
});
afterEach(async () => { await context?.close(); expect(errors).toEqual([]); });
afterAll(async () => { await context?.close(); await browser?.close(); });

describe('FE-04 auth generation ownership — synthetic real-provider regression', () => {
  it('ignores obsolete 401 body AbortError while a newer valid verification preserves the exact draft DOM', async () => {
    await page.getByTestId('filter-q').fill('PRESERVE_VALID_NEW_GENERATION');
    const originalURL = page.url();
    await page.evaluate(() => {
      (window as any).__draftNode = document.querySelector('[data-testid="filter-q"]');
      const saved = globalThis.fetch;
      globalThis.fetch = async (input, init) => {
        if (new URL(String(input), location.origin).pathname === '/api/me' && new Headers(init?.headers).get('Authorization') === 'Bearer SYNTHETIC_ACCESS_B') {
          const body = new ReadableStream({ start(controller) {
            (window as any).__older401HeadersReceived = true;
            init?.signal?.addEventListener('abort', () => { (window as any).__older401BodyAborted = true; controller.error(new DOMException('Body read aborted', 'AbortError')); }, { once: true });
          } });
          const response = new Response(body, { status: 401, headers: { 'Content-Type': 'application/json' } });
          const json = response.json.bind(response);
          response.json = () => { (window as any).__older401BodyStarted = true; return json().finally(() => { (window as any).__older401BodySettled = true; }); };
          return response;
        }
        return saved(input, init);
      };
      (window as any).__frontend.emit('TOKEN_REFRESHED', 'SYNTHETIC_ACCESS_B');
    });
    await page.waitForFunction(() => (window as any).__older401HeadersReceived && (window as any).__older401BodyStarted);
    expect(await page.getByTestId('filter-form').isVisible()).toBe(false);
    expect(await page.getByTestId('filter-q').evaluate(el => !!el.closest('[hidden][inert]'))).toBe(true);
    await page.evaluate(() => (window as any).__frontend.probe());
    expect(await page.evaluate(() => (window as any).__frontend.probeResult)).toBe('blocked');
    expect(await page.evaluate(() => (window as any).__frontend.requests.filter((r: any) => r.path === '/api/probe-privileged').length)).toBe(0);
    await page.evaluate(() => { (window as any).__frontend.holdVerification(); (window as any).__frontend.emit('TOKEN_REFRESHED', 'SYNTHETIC_ACCESS_C'); });
    await page.waitForFunction(() => (window as any).__older401BodyAborted && (window as any).__older401BodySettled);
    // Let the obsolete rejection run before releasing the newer successful /api/me.
    await page.evaluate(() => (window as any).__frontend.releaseVerification());
    await page.waitForFunction(() => !document.querySelector('.initializing'));
    const observation = await page.evaluate(() => ({ oldBodyAborted: (window as any).__older401BodyAborted, privateNodes: document.querySelectorAll('[data-testid="filter-form"]').length, loginNodes: document.querySelectorAll('[data-testid="login-form"]').length, mounts: (window as any).__frontend.mounts, unmounts: (window as any).__frontend.unmounts, completedMe: (window as any).__frontend.requests.filter((r: any) => r.path === '/api/me').map((r: any) => r.completed) }));
    console.log('AUTH_GENERATION_OBSERVATION ' + JSON.stringify(observation));
    expect(observation.loginNodes, 'stale 401 must not replace current verification with login').toBe(0);
    expect(observation).toMatchObject({ oldBodyAborted: true, privateNodes: 1, mounts: 1, unmounts: 0, completedMe: [true, true] });
    expect(await page.getByTestId('filter-q').inputValue()).toBe('PRESERVE_VALID_NEW_GENERATION');
    expect(await page.evaluate(() => (window as any).__draftNode === document.querySelector('[data-testid="filter-q"]'))).toBe(true);
    expect(page.url()).toBe(originalURL);
    await page.getByTestId('privileged-probe').click();
    await page.waitForFunction(() => (window as any).__frontend.probeResult === 'sent');
  });

  it.each(['json', 'malformed'])('fails closed through the current verification generation on a %s 401 body', async body => {
    await page.getByTestId('filter-q').fill('CLEAR_CURRENT_UNAUTHORIZED_DRAFT');
    await page.evaluate(body => {
      if (body === 'malformed') {
        const saved = globalThis.fetch;
        globalThis.fetch = async (input, init) => {
          const response = await saved(input, init);
          return new URL(String(input), location.origin).pathname === '/api/me' && new Headers(init?.headers).get('Authorization') === 'Bearer SYNTHETIC_ACCESS_B'
            ? new Response('UNTRUSTED_MALFORMED_BODY', { status: 401 }) : response;
        };
      }
      (window as any).__frontend.holdVerification('revoked');
      (window as any).__frontend.emit('TOKEN_REFRESHED', 'SYNTHETIC_ACCESS_B');
    }, body);
    await page.getByText('Memverifikasi izin akun…', { exact: true }).waitFor();
    await page.evaluate(() => (window as any).__frontend.probe());
    expect(await page.evaluate(() => (window as any).__frontend.probeResult)).toBe('blocked');
    await page.evaluate(() => (window as any).__frontend.releaseVerification());
    await page.getByTestId('login-form').waitFor();
    expect(await page.getByTestId('filter-form').count()).toBe(0);
    expect(await page.evaluate(() => (window as any).__frontend.unmounts)).toBe(1);
    expect(await page.getByRole('button', { name: 'Keluar dari sesi ini', exact: true }).count(), 'current /api/me rejection must be owned by AuthController').toBe(1);
    expect(await page.evaluate(() => (window as any).__syntheticSignOuts ?? 0)).toBe(0);
    expect(await page.locator('#root').textContent()).not.toContain('UNTRUSTED_MALFORMED_BODY');
    await page.evaluate(() => (window as any).__frontend.probe());
    expect(await page.evaluate(() => (window as any).__frontend.requests.filter((r: any) => r.path === '/api/probe-privileged').length)).toBe(0);
  });

  it.each(['initial', 'refreshed'])('still clears the %s current application session and signs out locally on an application API 401', async state => {
    await page.getByTestId('filter-q').fill('CLEAR_ON_CURRENT_APPLICATION_401');
    if (state === 'refreshed') {
      await page.evaluate(() => (window as any).__frontend.emit('TOKEN_REFRESHED', 'SYNTHETIC_ACCESS_C'));
      await page.waitForFunction(() => (window as any).__frontend.requests.filter((r: any) => r.path === '/api/me').length === 2 && (window as any).__frontend.requests.filter((r: any) => r.path === '/api/me').every((r: any) => r.completed) && !document.querySelector('.initializing'));
    }
    await page.evaluate(() => {
      const saved = globalThis.fetch;
      globalThis.fetch = async (input, init) => new URL(String(input), location.origin).pathname === '/api/probe-privileged'
        ? new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'UNTRUSTED_APP_401' } }), { status: 401 }) : saved(input, init);
    });
    await page.getByTestId('privileged-probe').click(); await page.getByTestId('login-form').waitFor();
    expect(await page.getByTestId('filter-form').count()).toBe(0);
    expect(await page.evaluate(() => (window as any).__frontend.unmounts)).toBe(1);
    expect(await page.evaluate(() => (window as any).__syntheticSignOuts)).toBe(1);
    expect(await page.locator('#root').textContent()).not.toContain('UNTRUSTED_APP_401');
    await page.evaluate(() => (window as any).__frontend.probe());
    expect(await page.evaluate(() => (window as any).__frontend.probeResult)).toBe('blocked');
  });

  it('ignores a late non-aborted 401 for an old application token after a newer token verifies', async () => {
    await page.getByTestId('filter-q').fill('PRESERVE_AFTER_OLD_APPLICATION_401');
    await page.evaluate(() => {
      (window as any).__draftNode = document.querySelector('[data-testid="filter-q"]');
      const saved = globalThis.fetch;
      globalThis.fetch = async (input, init) => {
        if (String(input) === '/api/applications?generation-probe=old') {
          (window as any).__oldAppSentWithInitialToken = new Headers(init?.headers).get('Authorization') === 'Bearer SYNTHETIC_ACCESS_A';
          return new Promise<Response>(resolve => { (window as any).__finishOldApp401 = () => {
            (window as any).__oldAppRequestAborted = init?.signal?.aborted ?? false;
            resolve(new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED' } }), { status: 401 }));
          }; });
        }
        return saved(input, init);
      };
      void (window as any).__privateApi.get('/api/applications?generation-probe=old').then(() => { (window as any).__oldAppResult = 'unexpected-success'; }, (error: any) => { (window as any).__oldAppResult = error.status; });
    });
    await page.waitForFunction(() => !!(window as any).__finishOldApp401);
    await page.evaluate(() => (window as any).__frontend.emit('TOKEN_REFRESHED', 'SYNTHETIC_ACCESS_C'));
    await page.waitForFunction(() => (window as any).__frontend.requests.filter((r: any) => r.path === '/api/me').length === 2 && (window as any).__frontend.requests.filter((r: any) => r.path === '/api/me').every((r: any) => r.completed) && !document.querySelector('.initializing'));
    expect(await page.getByTestId('filter-q').inputValue()).toBe('PRESERVE_AFTER_OLD_APPLICATION_401');
    await page.evaluate(() => (window as any).__finishOldApp401());
    await page.waitForFunction(() => (window as any).__oldAppResult === 401);
    const observation = await page.evaluate(() => ({ sentWithInitialToken: (window as any).__oldAppSentWithInitialToken, aborted: (window as any).__oldAppRequestAborted, loginNodes: document.querySelectorAll('[data-testid="login-form"]').length, mounts: (window as any).__frontend.mounts, unmounts: (window as any).__frontend.unmounts, signOuts: (window as any).__syntheticSignOuts ?? 0 }));
    console.log('OLD_APPLICATION_401_OBSERVATION ' + JSON.stringify(observation));
    expect(observation, 'an old application token cannot invalidate the newer verified session').toEqual({ sentWithInitialToken: true, aborted: false, loginNodes: 0, mounts: 1, unmounts: 0, signOuts: 0 });
    expect(await page.getByTestId('filter-q').inputValue()).toBe('PRESERVE_AFTER_OLD_APPLICATION_401');
    expect(await page.evaluate(() => (window as any).__draftNode === document.querySelector('[data-testid="filter-q"]'))).toBe(true);
    await page.getByTestId('privileged-probe').click();
    await page.waitForFunction(() => (window as any).__frontend.probeResult === 'sent');
  });

  it('cannot resurrect the private tree when an old 401 body finishes after a logout event', async () => {
    await page.getByTestId('filter-q').fill('CLEAR_LOGOUT_LATE_FAILURE');
    await page.evaluate(() => {
      const saved = globalThis.fetch;
      globalThis.fetch = async (input, init) => {
        if (new URL(String(input), location.origin).pathname === '/api/me' && new Headers(init?.headers).get('Authorization') === 'Bearer SYNTHETIC_ACCESS_B') {
          const body = new ReadableStream({ start(controller) {
            // Deliberately ignore cancellation until the body is released, testing the signal recheck.
            init?.signal?.addEventListener('abort', () => { (window as any).__late401Aborted = true; }, { once: true });
            (window as any).__releaseLate401 = () => { controller.enqueue(new TextEncoder().encode(JSON.stringify({ error: { code: 'UNAUTHORIZED' } }))); controller.close(); };
          } });
          const response = new Response(body, { status: 401 }); const json = response.json.bind(response);
          response.json = () => { (window as any).__late401BodyStarted = true; return json().finally(() => { (window as any).__late401BodySettled = true; }); };
          return response;
        }
        return saved(input, init);
      };
      (window as any).__frontend.emit('TOKEN_REFRESHED', 'SYNTHETIC_ACCESS_B');
    });
    await page.waitForFunction(() => (window as any).__late401BodyStarted);
    await page.evaluate(() => (window as any).__frontend.emit('SIGNED_OUT', null));
    await page.getByTestId('login-form').waitFor();
    await page.evaluate(() => (window as any).__releaseLate401());
    await page.waitForFunction(() => (window as any).__late401Aborted && (window as any).__late401BodySettled);
    await page.evaluate(() => (window as any).__frontend.probe());
    expect(await page.getByTestId('login-form').isVisible()).toBe(true);
    expect(await page.getByTestId('filter-form').count()).toBe(0);
    expect(await page.evaluate(() => ({ mounts: (window as any).__frontend.mounts, unmounts: (window as any).__frontend.unmounts, result: (window as any).__frontend.probeResult }))).toEqual({ mounts: 1, unmounts: 1, result: 'blocked' });
    expect(await page.locator('#root').textContent()).not.toContain('CLEAR_LOGOUT_LATE_FAILURE');
  });
});
