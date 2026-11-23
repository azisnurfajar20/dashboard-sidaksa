import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
let browser: Browser; let context: BrowserContext; let page: Page; let bundle: string;
const errors: string[] = [];
const sdk = `export function createClient(){let token='SYNTHETIC_ACCESS_A';const listeners=new Set();const emit=(event,next)=>{token=next;for(const cb of listeners)cb(event,token?{access_token:token}:null)};globalThis.__emitSyntheticAuth=emit;return {auth:{onAuthStateChange(cb){listeners.add(cb);return {data:{subscription:{unsubscribe(){listeners.delete(cb)}}}}},async getSession(){return {data:{session:token?{access_token:token}:null},error:null}},stopAutoRefresh(){},async signOut(){emit('SIGNED_OUT',null);return {error:null}}}}}`;
beforeAll(async () => {
  const temp = resolve('.private/test-tmp/frontend-findings-browser'); mkdirSync(temp, { recursive: true });
  const result = await build({ entryPoints: ['tests/frontend/verified-findings.entry.tsx'], bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' }, plugins: [{ name: 'synthetic-sdk-only', setup(build) { build.onResolve({ filter: /^@supabase\/supabase-js$/ }, () => ({ path: 'synthetic-sdk', namespace: 'fixture' })); build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: sdk, loader: 'ts' })); } }] });
  bundle = result.outputFiles[0]!.text.replaceAll('</script', '<\\/script');
  browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--disable-gpu'], env: { ...process.env, TEMP: temp, TMP: temp, TMPDIR: temp } });
}, 60000);
beforeEach(async () => { errors.length = 0; context = await browser.newContext(); page = await context.newPage(); page.setDefaultTimeout(5000); page.on('pageerror', e => errors.push(e.message)); });
afterEach(async () => { await context?.close(); expect(errors).toEqual([]); });
afterAll(async () => { await context?.close(); await browser?.close(); });
async function go(route: string, mode = 'normal', entityType = 'company') {
  // Every URL is fulfilled in memory or aborted: the browser cannot reach a live service.
  await context.route('**/*', r => r.request().isNavigationRequest() ? r.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body><div id="root"></div><script>window.__frontendMode=' + JSON.stringify(mode) + ';window.__entityType=' + JSON.stringify(entityType) + ';</script><script>' + bundle + '</script></body></html>' }) : r.abort());
  await page.goto('http://sidaksa-fixture.invalid' + route); await page.getByTestId('filter-form').waitFor(); await page.getByTestId('data-row').first().waitFor();
}
async function apiRequests(prefix: string) { return page.evaluate(prefix => (window as any).__frontend.requests.filter((r: any) => r.path.startsWith(prefix)), prefix); }
describe('verified frontend findings — synthetic real-provider browser regression', () => {
  it('FE-01 clears every dirty unapplied business draft when Reset leaves the URL identical', async () => {
    await go('/rekrutmen?snapshotId=synthetic-A&page=1&limit=50&sort=candidateName&direction=desc');
    await page.getByTestId('filter-q').fill('UNAPPLIED_SYNTHETIC_DRAFT');
    await page.getByTestId('filter-from').fill('2026-11-01'); await page.getByTestId('filter-to').fill('2026-11-30');
    await page.getByTestId('filter-more').click(); await page.getByTestId('filter-status').selectOption('Completed');
    await page.getByTestId('filter-reset').click();
    expect(await page.getByTestId('filter-q').inputValue()).toBe('');
    for (const key of ['from', 'to', 'status']) expect(await page.getByTestId('filter-' + key).inputValue()).toBe('');
    await page.getByTestId('filter-apply').click();
    const query = new URL(page.url()).searchParams;
    for (const key of ['q', 'from', 'to', 'status']) expect(query.has(key)).toBe(false);
    expect(Object.fromEntries(query)).toEqual({ snapshotId: 'synthetic-A', page: '1', limit: '50', sort: 'candidateName', direction: 'desc' });
  });
  it.each([
    ['company', '/mitra', 'companies', 'CO_SYNTHETIC', 'Synthetic Company'],
    ['agent', '/mitra', 'agents', 'AGENT_TEST', 'Agen uji'],
    ['candidate', '/kandidat', null, 'TEST_01', 'Kandidat uji'],
    ['application', '/rekrutmen', null, 'application:test:597', 'Kandidat uji'],
  ])('FE-02 routes %s issues to the exact supported master and displays its row', async (entityType, route, kind, id, name) => {
    await go('/kualitas-data?snapshotId=synthetic-A', 'normal', entityType!);
    await page.getByTestId('issue-review').click();
    const link = page.getByRole('link', { name: 'Lihat entitas terdampak' });
    const href = new URL((await link.getAttribute('href'))!, page.url());
    expect(href.pathname).toBe(route); expect(href.searchParams.get('q')).toBe(id);
    expect(href.searchParams.get('kind')).toBe(kind); expect(href.searchParams.get('snapshotId')).toBe('synthetic-A');
    await link.click(); await page.getByTestId('data-row').first().waitFor();
    expect(await page.getByTestId('data-row').first().textContent()).toContain(name);
    if (kind) expect(await page.getByTestId('partner-' + kind).getAttribute('aria-pressed')).toBe('true');
    expect(await page.getByTestId('state-empty').count()).toBe(0);
  });
  it.each(['source', 'aggregate', 'unsupported'])('FE-02 offers no fabricated entity link for %s issues', async entityType => {
    await go('/kualitas-data?snapshotId=synthetic-A', 'normal', entityType);
    await page.getByTestId('issue-review').click();
    expect(await page.getByRole('link', { name: 'Lihat entitas terdampak' }).count()).toBe(0);
  });
  it('MASTER labels partner list filters as master predicates, not application cohort filters', async () => {
    await go('/mitra?kind=companies&snapshotId=synthetic-A');
    expect(await page.getByLabel('Negara master', { exact: true }).count()).toBe(1);
    expect(await page.getByLabel('Masalah data master', { exact: true }).count()).toBe(1);
    expect(await page.getByRole('form', { name: 'Filter daftar' }).count()).toBe(1);
  });

  it('FE-03 ambiguous candidate detail explains identity review rather than snapshot replacement', async () => {
    await go('/kandidat?snapshotId=synthetic-A', 'ambiguous');
    await page.getByTestId('candidate-detail').first().click();
    const modal = page.getByTestId('detail-modal'); const error = modal.getByTestId('state-error'); await error.waitFor();
    expect(await error.textContent()).not.toContain('Snapshot telah berubah');
    expect(await error.textContent()).toMatch(/ID.*(berulang|ambigu)/);
    expect(await error.textContent()).toContain('Kualitas data');
    expect(await modal.getByRole('button', { name: 'Muat data terbaru' }).count()).toBe(0);
    expect(await apiRequests('/api/candidates/')).toHaveLength(1);
    await page.keyboard.press('Escape'); await page.getByTestId('nav-kualitas-data').click();
    await page.getByTestId('issue-review').waitFor();
  });

  it.each(['TOKEN_REFRESHED', 'SIGNED_IN'])('FE-04 preserves the same authorized tree and exact filter draft after a verified %s event', async event => {
    await go('/rekrutmen?snapshotId=synthetic-A&page=1');
    await page.getByTestId('filter-q').fill('PRESERVE_SYNTHETIC_REFRESH_DRAFT');
    await page.getByTestId('filter-from').fill('2026-11-01');
    const before = await apiRequests('/api/me'); const originalURL = page.url();
    await page.evaluate(event => { (window as any).__draftNode = document.querySelector('[data-testid="filter-q"]'); (window as any).__frontend.holdVerification(); (window as any).__frontend.emit(event, event === 'SIGNED_IN' ? 'SYNTHETIC_ACCESS_A' : 'SYNTHETIC_ACCESS_B'); }, event);
    await page.waitForFunction(count => (window as any).__frontend.requests.filter((r: any) => r.path === '/api/me').length === count + 1, before.length);
    await page.evaluate(() => (window as any).__frontend.releaseVerification());
    await page.getByTestId('filter-q').waitFor();
    expect(await page.getByTestId('filter-q').inputValue()).toBe('PRESERVE_SYNTHETIC_REFRESH_DRAFT');
    expect(await page.getByTestId('filter-from').inputValue()).toBe('2026-11-01');
    expect(await page.evaluate(() => (window as any).__draftNode === document.querySelector('[data-testid="filter-q"]'))).toBe(true);
    expect(await page.evaluate(() => (window as any).__frontend.mounts)).toBe(1);
    expect(page.url()).toBe(originalURL);
    expect((await apiRequests('/api/me')).at(-1).completed).toBe(true);
    await page.getByTestId('privileged-probe').click();
    await page.waitForFunction(() => (window as any).__frontend.probeResult === 'sent');
    const probes = await apiRequests('/api/probe-privileged'); expect(probes).toHaveLength(1);
    if (event === 'TOKEN_REFRESHED') expect(probes[0].refreshedBearer).toBe(true);
  });
  it('FE-04 hides and makes the retained tree inert and blocks even captured API clients while token verification is pending', async () => {
    await go('/rekrutmen?snapshotId=synthetic-A');
    await page.evaluate(() => { (window as any).__frontend.holdVerification(); (window as any).__frontend.emit('TOKEN_REFRESHED', 'SYNTHETIC_ACCESS_B'); });
    await page.getByText('Memverifikasi izin akun…', { exact: true }).waitFor();
    expect(await page.getByTestId('filter-form').isVisible()).toBe(false);
    await page.evaluate(() => (window as any).__frontend.probe());
    expect(await page.evaluate(() => (window as any).__frontend.probeResult)).toBe('blocked');
    expect(await apiRequests('/api/probe-privileged')).toHaveLength(0);
    expect(await page.getByTestId('privileged-probe').evaluate(el => !!el.closest('[inert][hidden]'))).toBe(true);
    await page.getByTestId('privileged-probe').evaluate((el: HTMLElement) => el.click());
    expect(await apiRequests('/api/probe-privileged')).toHaveLength(0);
    await page.evaluate(() => (window as any).__frontend.releaseVerification());
    await page.getByTestId('filter-form').waitFor();
  });
  it('FE-04 retains an unsaved review form and modal through a verified same-permission refresh without sending a review', async () => {
    await go('/kualitas-data?snapshotId=synthetic-A'); await page.getByTestId('issue-review').click();
    await page.getByTestId('review-note').fill('Synthetic nonsecret draft decision');
    await page.evaluate(() => { (window as any).__frontend.holdVerification(); (window as any).__frontend.emit('TOKEN_REFRESHED', 'SYNTHETIC_ACCESS_B'); });
    await page.getByText('Memverifikasi izin akun…', { exact: true }).waitFor();
    await page.keyboard.press('Escape'); await page.keyboard.press('Tab');
    expect(await page.getByTestId('detail-modal').count()).toBe(1);
    await page.evaluate(() => (window as any).__frontend.releaseVerification());
    await page.getByTestId('detail-modal').waitFor();
    expect(await page.getByTestId('review-note').inputValue()).toBe('Synthetic nonsecret draft decision');
    expect((await apiRequests('/api/issues/')).filter((r: any) => r.method === 'POST')).toHaveLength(0);
  });
  it.each(['identity', 'role', 'permission'])('FE-04 discards old drafts and remounts private data after verified %s changes', async change => {
    await go('/rekrutmen?snapshotId=synthetic-A'); await page.getByTestId('filter-q').fill('DO_NOT_TRANSFER_THIS_DRAFT');
    await page.evaluate(change => { (window as any).__frontend.holdVerification(change); (window as any).__frontend.emit('TOKEN_REFRESHED', 'SYNTHETIC_ACCESS_B'); }, change);
    await page.getByText('Memverifikasi izin akun…', { exact: true }).waitFor();
    await page.evaluate(() => (window as any).__frontend.releaseVerification()); await page.getByTestId('data-row').waitFor();
    expect(await page.getByTestId('filter-q').inputValue()).toBe('');
    expect(await page.evaluate(() => (window as any).__frontend.mounts)).toBe(2);
    expect(await page.evaluate(() => (window as any).__frontend.unmounts)).toBe(1);
    if (change === 'permission') expect(await page.getByTestId('nav-pengaturan').count()).toBe(0);
  });
  it.each(['invalid', 'invalid-identity', 'denied', 'revoked'])('FE-04 clears the sensitive tree when refreshed session is %s', async change => {
    await go('/kualitas-data?snapshotId=synthetic-A'); await page.getByTestId('issue-review').click();
    await page.getByTestId('review-note').fill('SENSITIVE_DRAFT_MUST_BE_CLEARED');
    await page.evaluate(change => { (window as any).__frontend.holdVerification(change); (window as any).__frontend.emit('TOKEN_REFRESHED', 'SYNTHETIC_ACCESS_B'); }, change);
    await page.getByText('Memverifikasi izin akun…', { exact: true }).waitFor();
    await page.evaluate(() => (window as any).__frontend.releaseVerification()); await page.getByTestId('login-form').waitFor();
    expect(await page.getByTestId('detail-modal').count()).toBe(0); expect(await page.getByTestId('filter-form').count()).toBe(0);
    expect(await page.locator('#root').textContent()).not.toContain('SENSITIVE_DRAFT_MUST_BE_CLEARED');
    expect(await page.evaluate(() => (window as any).__frontend.unmounts)).toBe(1);
    await page.evaluate(() => (window as any).__frontend.probe()); expect(await apiRequests('/api/probe-privileged')).toHaveLength(0);
  });
  it('FE-04 logout during verification clears the tree and a late valid refresh cannot resurrect it', async () => {
    await go('/rekrutmen?snapshotId=synthetic-A'); await page.getByTestId('filter-q').fill('CLEAR_ON_LOGOUT');
    await page.evaluate(() => { (window as any).__frontend.holdVerification(); (window as any).__frontend.emit('TOKEN_REFRESHED', 'SYNTHETIC_ACCESS_B'); });
    await page.getByText('Memverifikasi izin akun…', { exact: true }).waitFor();
    await page.evaluate(() => (window as any).__frontend.emit('SIGNED_OUT', null)); await page.getByTestId('login-form').waitFor();
    await page.evaluate(() => (window as any).__frontend.releaseVerification());
    await page.waitForFunction(() => (window as any).__frontend.requests.filter((r: any) => r.path === '/api/me').every((r: any) => r.completed));
    expect(await page.getByTestId('filter-form').count()).toBe(0); expect(await page.getByTestId('login-form').isVisible()).toBe(true);
    await page.evaluate(() => (window as any).__frontend.probe()); expect(await apiRequests('/api/probe-privileged')).toHaveLength(0);
  });
  it('FE-04 explicit logout clears the private tree immediately', async () => {
    await go('/rekrutmen?snapshotId=synthetic-A'); await page.getByTestId('filter-q').fill('CLEAR_ON_LOGOUT');
    await page.getByTestId('logout').click(); await page.getByTestId('login-form').waitFor();
    expect(await page.getByTestId('filter-form').count()).toBe(0);
    expect(await page.evaluate(() => (window as any).__frontend.unmounts)).toBe(1);
  });

  it('FE-05 rejects one stale review POST, requires explicit latest, closes the stale modal and preserves list filters without retry', async () => {
    const filters = 'q=CO_SYNTHETIC&severity=critical&code=DUPLICATE_ID&reviewStatus=open&limit=50&sort=code&direction=desc';
    await go('/kualitas-data?snapshotId=synthetic-A&' + filters);
    await page.getByTestId('issue-review').click(); await page.getByTestId('review-note').fill('Synthetic stale review must not be retried');
    await page.evaluate(() => (window as any).__frontend.publish()); await page.getByTestId('review-save').click();
    await page.getByTestId('detail-modal').getByRole('alert').waitFor();
    const latest = page.getByRole('button', { name: 'Muat data terbaru', exact: true });
    expect(await latest.count()).toBe(1);
    expect(await page.getByTestId('detail-modal').isVisible()).toBe(true);
    expect(new URL(page.url()).searchParams.get('snapshotId')).toBe('synthetic-A');
    let writes = (await apiRequests('/api/issues/')).filter((r: any) => r.method === 'POST');
    expect(writes).toHaveLength(1); expect(writes[0].rejected).toBe(true); expect(writes[0].body.snapshotId).toBe('synthetic-A');
    expect(await page.getByTestId('review-save').isDisabled()).toBe(true);
    await page.getByTestId('review-save').evaluate((el: HTMLButtonElement) => el.form!.requestSubmit());
    expect((await apiRequests('/api/issues/')).filter((r: any) => r.method === 'POST')).toHaveLength(1);
    await latest.click(); await page.waitForURL(/snapshotId=synthetic-B/); await page.getByTestId('data-row').first().waitFor();
    expect(await page.getByTestId('detail-modal').count()).toBe(0);
    const query = new URL(page.url()).searchParams;
    for (const [key, value] of new URLSearchParams(filters)) expect(query.get(key)).toBe(value);
    writes = (await apiRequests('/api/issues/')).filter((r: any) => r.method === 'POST'); expect(writes).toHaveLength(1);
    expect(await page.getByTestId('review-success').count()).toBe(0);
    const latestReads = (await apiRequests('/api/issues?')).filter((r: any) => !r.path.includes('snapshotId=synthetic-A'));
    expect(latestReads.length).toBeGreaterThan(0);
    for (const request of latestReads) {
      const sent = new URL(request.path, page.url()).searchParams;
      for (const [key, value] of new URLSearchParams(filters)) expect(sent.get(key)).toBe(value);
    }
  });

  it('FE-01 Reset clears partner drafts but preserves selected master, snapshot and page-size context', async () => {
    await go('/mitra?kind=companies&snapshotId=synthetic-A&page=1&limit=50');
    await page.getByTestId('filter-q').fill('DISCARD_THIS_PARTNER_DRAFT');
    await page.getByTestId('filter-country').selectOption('Jepang'); await page.getByTestId('filter-issue').selectOption('DUPLICATE_ID');
    await page.getByTestId('filter-reset').click(); await page.getByTestId('filter-apply').click();
    for (const key of ['q', 'country', 'issue']) expect(await page.getByTestId('filter-' + key).inputValue()).toBe('');
    expect(Object.fromEntries(new URL(page.url()).searchParams)).toEqual({ kind: 'companies', snapshotId: 'synthetic-A', page: '1', limit: '50' });
    expect(await page.getByTestId('partner-companies').getAttribute('aria-pressed')).toBe('true');
  });
  it('FE-04 removes old sensitive details on a permission change and the new verified tree uses the reduced permissions', async () => {
    await go('/kandidat?snapshotId=synthetic-A'); await page.getByTestId('candidate-detail').click();
    await page.getByTestId('detail-modal').getByText('TEST-CONTACT', { exact: true }).waitFor();
    await page.evaluate(() => { (window as any).__frontend.holdVerification('permission'); (window as any).__frontend.emit('TOKEN_REFRESHED', 'SYNTHETIC_ACCESS_B'); });
    await page.getByText('Memverifikasi izin akun…', { exact: true }).waitFor();
    expect(await page.getByTestId('detail-modal').isVisible()).toBe(false);
    await page.evaluate(() => (window as any).__frontend.releaseVerification()); await page.getByTestId('candidate-detail').waitFor();
    expect(await page.getByTestId('detail-modal').count()).toBe(0);
    expect(await page.locator('#root').textContent()).not.toContain('TEST-CONTACT');
    await page.getByTestId('candidate-detail').click(); await page.getByTestId('detail-modal').getByText('Kontak, foto, dan catatan pribadi tidak tersedia untuk izin akun ini.').waitFor();
    expect(await page.getByTestId('detail-modal').textContent()).not.toContain('TEST-CONTACT');
  });

});
