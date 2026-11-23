import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const evidenceRoot = resolve(process.env.MODAL_VISUAL_EVIDENCE_DIR ?? '.private/evidence/modal-fix-20261123');
const phase = process.env.MODAL_VISUAL_PHASE ?? 'regression';
const evidenceDir = resolve(evidenceRoot, phase);
const viewports = [{ name: 'desktop', width: 1572, height: 988 }, { name: 'mobile', width: 390, height: 844 }, { name: 'compact', width: 320, height: 568 }];
const sdk = `export function createClient(){let token='SYNTHETIC_ACCESS_A';const listeners=new Set();const emit=(event,next)=>{token=next;for(const cb of listeners)cb(event,token?{access_token:token}:null)};globalThis.__emitSyntheticAuth=emit;return {auth:{onAuthStateChange(cb){listeners.add(cb);return {data:{subscription:{unsubscribe(){listeners.delete(cb)}}}}},async getSession(){return {data:{session:token?{access_token:token}:null},error:null}},stopAutoRefresh(){},async signOut(){emit('SIGNED_OUT',null);return {error:null}}}}}`;
let browser: Browser; let context: BrowserContext; let page: Page; let jsBundle: string; let cssBundle: string;
const errors: string[] = [];
const blockedRequests: string[] = [];
const observations: Record<string, unknown>[] = [];

function sourceHashes() {
  return Object.fromEntries(['web/components/ui.tsx', 'web/styles.css', 'tests/frontend/modal-visual.test.ts', 'tests/frontend/modal-visual.entry.tsx', 'node_modules/bootstrap/dist/css/bootstrap.min.css'].map(path => [path, createHash('sha256').update(readFileSync(resolve(path))).digest('hex')]));
}
beforeAll(async () => {
  mkdirSync(evidenceDir, { recursive: true });
  const temp = resolve('.private/test-tmp/modal-visual-browser'); mkdirSync(temp, { recursive: true });
  const result = await build({ entryPoints: ['tests/frontend/modal-visual.entry.tsx'], outfile: 'modal-fixture.js', bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' }, plugins: [{ name: 'synthetic-sdk-only', setup(build) { build.onResolve({ filter: /^@supabase\/supabase-js$/ }, () => ({ path: 'modal-sdk', namespace: 'fixture' })); build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: sdk, loader: 'ts' })); } }] });
  jsBundle = result.outputFiles.find(file => file.path.endsWith('.js'))!.text.replaceAll('</script', '<\\/script');
  cssBundle = result.outputFiles.find(file => file.path.endsWith('.css'))!.text.replaceAll('</style', '<\\/style');
  browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--disable-gpu'], env: { ...process.env, TEMP: temp, TMP: temp, TMPDIR: temp } });
  const probe = await browser.newPage();
  await probe.setContent('<!doctype html><p>SIDAKSA isolated browser probe</p>');
  expect(await probe.locator('p').textContent()).toBe('SIDAKSA isolated browser probe'); await probe.close();
  writeFileSync(resolve(evidenceDir, 'run-source.json'), JSON.stringify({ phase, browser: browser.version(), sourceSha256: sourceHashes(), cssIncludesBootstrap: cssBundle.includes('--bs-modal-bg'), cssBytes: Buffer.byteLength(cssBundle), noListener: true, envFilesLoaded: false, temp }, null, 2));
}, 60000);
beforeEach(async () => {
  errors.length = 0; blockedRequests.length = 0;
  context = await browser.newContext({ serviceWorkers: 'block', reducedMotion: 'reduce' });
  page = await context.newPage(); page.setDefaultTimeout(7000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' || message.type() === 'warning') errors.push(message.text()); });
});
afterEach(async () => { await context?.close(); expect(errors, 'no browser errors or React/accessibility warnings').toEqual([]); expect(blockedRequests, 'no attempted external requests').toEqual([]); });
afterAll(async () => { await context?.close(); await browser?.close(); writeFileSync(resolve(evidenceDir, 'observations.json'), JSON.stringify(observations, null, 2)); });

async function go(viewport: typeof viewports[number], route = '/kualitas-data', long = false) {
  await page.setViewportSize(viewport);
  await context.route('**/*', request => {
    if (request.request().isNavigationRequest() && new URL(request.request().url()).hostname === 'sidaksa-modal-visual.invalid') return request.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="id"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><style>' + cssBundle + '</style></head><body><div id="root"></div><script>window.__modalLong=' + JSON.stringify(long) + ';</script><script>' + jsBundle + '</script></body></html>' });
    blockedRequests.push(request.request().url()); return request.abort();
  });
  const url = new URL(route, 'http://sidaksa-modal-visual.invalid'); url.searchParams.set('snapshotId', 'synthetic-A');
  await page.goto(url.href);
  await page.getByTestId('data-row').first().waitFor();
}
async function capture(name: string) {
  const state = await page.evaluate(() => {
    const props = (selector: string) => {
      const el = document.querySelector<HTMLElement>(selector); if (!el) return null;
      const css = getComputedStyle(el); const r = el.getBoundingClientRect();
      return { className: el.className, backgroundColor: css.backgroundColor, color: css.color, opacity: css.opacity, visibility: css.visibility, pointerEvents: css.pointerEvents, position: css.position, zIndex: css.zIndex, overflowX: css.overflowX, overflowY: css.overflowY, minHeight: css.minHeight, maxHeight: css.maxHeight, modalBg: css.getPropertyValue('--bs-modal-bg').trim(), modalHeaderBorder: css.borderBottomWidth, rect: { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }, clientWidth: el.clientWidth, scrollWidth: el.scrollWidth, clientHeight: el.clientHeight, scrollHeight: el.scrollHeight, scrollTop: el.scrollTop };
    };
    const panel = document.querySelector('.modal-content')!; const r = panel.getBoundingClientRect();
    const topAtPanel = document.elementFromPoint(Math.min(innerWidth - 1, r.left + 12), Math.min(innerHeight - 1, r.top + 12));
    return { viewport: { width: innerWidth, height: innerHeight }, bodyOverflow: document.body.style.overflow, documentWidth: document.documentElement.scrollWidth, activeTestId: document.activeElement?.getAttribute('data-testid'), panelIsTopAtPoint: panel.contains(topAtPanel), layer: props('.modal-layer'), dialog: props('[data-testid="detail-modal"]'), content: props('.modal-content'), header: props('.modal-header'), body: props('.modal-body'), close: props('[data-testid="modal-close"]'), sidebar: props('.sidebar'), drawer: props('.drawer-backdrop') };
  });
  const screenshot = resolve(evidenceDir, name + '.png'); await page.screenshot({ path: screenshot });
  const observation = { name, ...state, screenshot, errors: [...errors], blockedRequests: [...blockedRequests] }; observations.push(observation);
  writeFileSync(resolve(evidenceDir, name + '.json'), JSON.stringify(observation, null, 2)); return state;
}
function assertSurface(state: Awaited<ReturnType<typeof capture>>) {
  expect(state.content!.backgroundColor, 'shared modal surface must be opaque white, not show the underlying page').toBe('rgb(255, 255, 255)');
  expect(state.content!.opacity).toBe('1');
  expect(state.content!.color).toBe('rgb(23, 50, 76)');
  expect(state.content!.modalBg, 'installed Bootstrap modal variables must have a scope').not.toBe('');
  expect(state.layer!.backgroundColor).toBe('rgba(13, 31, 49, 0.48)');
  expect(state.panelIsTopAtPoint, 'backdrop must be below the panel').toBe(true);
  expect(Number(state.layer!.zIndex)).toBeGreaterThan(Number(state.sidebar!.zIndex));
  expect(state.content!.rect.x).toBeGreaterThanOrEqual(0);
  expect(state.content!.rect.right).toBeLessThanOrEqual(state.viewport.width);
  expect(state.documentWidth).toBeLessThanOrEqual(state.viewport.width);
  expect(state.bodyOverflow).toBe('hidden');
}

describe('shared modal real Bootstrap visual regression — offline synthetic app', () => {
  it.each(viewports)('$name review has an opaque readable interactive panel above the backdrop/sidebar', async viewport => {
    await go(viewport); await page.getByTestId('issue-review').click();
    const state = await capture(viewport.name + '-review'); assertSurface(state);
    const modal = page.getByTestId('detail-modal');
    expect(await modal.getAttribute('aria-modal')).toBe('true');
    expect(await modal.getByRole('heading', { name: 'Tinjauan masalah data' }).isVisible()).toBe(true);
    await page.getByTestId('review-status').selectOption('reviewed');
    await page.getByTestId('review-note').fill('Catatan sintetis: keputusan dicatat terpisah dari sumber.');
    expect(await page.getByTestId('review-status').inputValue()).toBe('reviewed');
    expect(await page.getByTestId('review-save').isEnabled()).toBe(true);
    await capture(viewport.name + '-review-edited');
    await page.getByTestId('modal-close').click();
    expect(await page.getByTestId('detail-modal').count()).toBe(0);
    expect(await page.getByTestId('issue-review').evaluate(el => document.activeElement === el)).toBe(true);
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('');
  });
  it.each(viewports)('$name long review keeps its header/close in the viewport while the body scrolls and fields remain usable', async viewport => {
    await go(viewport, '/kualitas-data', true); await page.getByTestId('issue-review').click();
    const top = await capture(viewport.name + '-long-top'); assertSurface(top);
    expect(top.content!.rect.y, 'long dialog must not scroll its title above the viewport on focus').toBeGreaterThanOrEqual(0);
    expect(top.content!.rect.bottom, 'long dialog must be bounded by the viewport, with a separate body scroller').toBeLessThanOrEqual(viewport.height);
    expect(top.body!.overflowY).toBe('auto');
    expect(top.body!.scrollHeight).toBeGreaterThan(top.body!.clientHeight);
    await page.locator('.modal-body').hover(); await page.mouse.wheel(0, 700);
    await page.waitForFunction(() => document.querySelector('.modal-body')!.scrollTop > 0);
    await page.getByTestId('review-status').click(); await page.keyboard.press('Home'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
    expect(await page.getByTestId('review-status').inputValue()).toBe('reviewed');
    await page.getByTestId('review-note').click(); await page.getByTestId('review-note').fill('Draf sintetis panjang — kontrol tetap dapat diakses.');
    await page.getByTestId('review-save').scrollIntoViewIfNeeded();
    const bottom = await capture(viewport.name + '-long-bottom');
    expect(bottom.body!.scrollTop).toBeGreaterThan(0);
    expect(bottom.close!.rect.y).toBe(top.close!.rect.y);
    expect(bottom.close!.rect.bottom).toBeLessThanOrEqual(viewport.height);
    expect(await page.getByTestId('review-save').isEnabled()).toBe(true);
    await page.keyboard.press('Escape');
    expect(await page.getByTestId('detail-modal').count()).toBe(0);
    expect(await page.getByTestId('issue-review').evaluate(el => document.activeElement === el)).toBe(true);
    expect(await page.evaluate(() => (window as any).__frontend.requests.filter((r: any) => r.method === 'POST').length)).toBe(0);
  });
  it.each(viewports)('$name keyboard focus wraps forward/backward; panel clicks stay open and backdrop closes without navigating', async viewport => {
    await go(viewport); const url = page.url(); await page.getByTestId('issue-review').click();
    expect(await page.getByTestId('detail-modal').evaluate(el => document.activeElement === el)).toBe(true);
    await page.keyboard.press('Tab');
    expect(await page.getByTestId('modal-close').evaluate(el => document.activeElement === el)).toBe(true);
    await page.keyboard.press('Shift+Tab');
    expect(await page.getByTestId('review-note').evaluate(el => document.activeElement === el)).toBe(true);
    await page.getByTestId('review-note').fill('Draf sintetis untuk memeriksa perangkap fokus.');
    await page.getByTestId('review-save').focus(); await page.keyboard.press('Tab');
    expect(await page.getByTestId('modal-close').evaluate(el => document.activeElement === el)).toBe(true);
    await page.keyboard.press('Shift+Tab');
    expect(await page.getByTestId('review-save').evaluate(el => document.activeElement === el)).toBe(true);
    const focusSteps: boolean[] = [];
    for (let i = 0; i < 14; i++) { await page.keyboard.press('Tab'); focusSteps.push(await page.getByTestId('detail-modal').evaluate(el => el.contains(document.activeElement))); }
    writeFileSync(resolve(evidenceDir, viewport.name + '-focus-trap.json'), JSON.stringify({ focusSteps }, null, 2));
    expect(focusSteps.every(Boolean)).toBe(true);
    await page.getByRole('heading', { name: 'Tinjauan masalah data' }).click();
    expect(await page.getByTestId('detail-modal').isVisible()).toBe(true);
    await page.mouse.click(1, 1);
    const focus = await page.evaluate(() => ({ activeTag: document.activeElement?.tagName, activeTestId: document.activeElement?.getAttribute('data-testid'), openerConnected: document.querySelector('[data-testid="issue-review"]')?.isConnected, bodyOverflow: document.body.style.overflow }));
    writeFileSync(resolve(evidenceDir, viewport.name + '-backdrop-close-focus.json'), JSON.stringify(focus, null, 2));
    expect(await page.getByTestId('detail-modal').count()).toBe(0); expect(page.url()).toBe(url);
    expect(focus.activeTestId, 'backdrop mousedown default must not steal the restored opener focus').toBe('issue-review');
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('');
  });
  for (const consumer of [
    { name: 'candidate', route: '/kandidat', opener: 'candidate-detail', title: 'Profil kandidat', ready: 'Kontak dan catatan berizin' },
    { name: 'application', route: '/rekrutmen', opener: 'application-detail', title: 'Rincian lamaran', ready: 'Bukti milestone yang tersedia' },
    { name: 'agent', route: '/mitra', opener: 'partner-detail', title: 'Rincian master mitra', ready: 'Tinjau masalah ID sumber' },
    { name: 'company', route: '/mitra?kind=companies', opener: 'partner-detail', title: 'Rincian master mitra', ready: 'Tinjau masalah ID sumber' },
  ]) {
    it.each(viewports)(`$name ${consumer.name} shared-modal consumer is opaque, bounded and keeps table overflow local`, async viewport => {
      await go(viewport, consumer.route); await page.getByTestId(consumer.opener).first().click();
      const modal = page.getByRole('dialog', { name: consumer.title, exact: true });
      await modal.getByText(consumer.ready, { exact: true }).waitFor();
      const top = await capture(viewport.name + '-' + consumer.name + '-top'); assertSurface(top);
      expect(top.content!.rect.y).toBeGreaterThanOrEqual(0); expect(top.content!.rect.bottom).toBeLessThanOrEqual(viewport.height);
      writeFileSync(resolve(evidenceDir, viewport.name + '-' + consumer.name + '-aria.txt'), await modal.ariaSnapshot());
      if (viewport.width <= 390 && ['candidate', 'application'].includes(consumer.name)) {
        const scroller = modal.locator('.table-responsive').first();
        const horizontal = await scroller.evaluate(el => { const before = el.scrollLeft; el.scrollLeft = el.scrollWidth; return { before, after: el.scrollLeft, clientWidth: el.clientWidth, scrollWidth: el.scrollWidth }; });
        expect(horizontal.scrollWidth).toBeGreaterThan(horizontal.clientWidth); expect(horizontal.after).toBeGreaterThan(0);
      }
      await modal.locator('.modal-body').evaluate(el => { el.scrollTop = el.scrollHeight; });
      const bottom = await capture(viewport.name + '-' + consumer.name + '-bottom');
      expect(bottom.close!.rect.y).toBe(top.close!.rect.y);
      expect(bottom.content!.scrollWidth).toBeLessThanOrEqual(bottom.content!.clientWidth + 1);
      await page.keyboard.press('Escape'); expect(await modal.count()).toBe(0);
      expect(await page.getByTestId(consumer.opener).first().evaluate(el => document.activeElement === el)).toBe(true);
      expect(await page.evaluate(() => document.body.style.overflow)).toBe('');
    });
  }
  it.each(viewports.filter(viewport => viewport.width <= 390))('$name drawer and modal maintain separate inert/stacking/scroll lifetimes', async viewport => {
    await go(viewport); await page.getByTestId('nav-toggle').click();
    expect(await page.locator('.drawer-backdrop').isVisible()).toBe(true);
    expect(await page.locator('.workspace-main').getAttribute('inert')).not.toBe(null);
    await page.screenshot({ path: resolve(evidenceDir, viewport.name + '-drawer-before-modal.png') });
    await page.keyboard.press('Escape'); expect(await page.locator('.drawer-backdrop').count()).toBe(0);
    expect(await page.locator('.workspace-main').getAttribute('inert')).toBe(null);
    expect(await page.getByTestId('nav-toggle').evaluate(el => document.activeElement === el)).toBe(true);
    await page.getByTestId('issue-review').click();
    const state = await capture(viewport.name + '-modal-after-drawer'); assertSurface(state);
    expect(state.drawer).toBe(null);
    await page.getByTestId('modal-close').click(); expect(await page.evaluate(() => document.body.style.overflow)).toBe('');
    await page.getByTestId('nav-toggle').click(); expect(await page.locator('.drawer-backdrop').isVisible()).toBe(true);
    await page.keyboard.press('Escape'); expect(await page.evaluate(() => document.body.style.overflow)).toBe('');
  });
  it('blocks the retained hidden/inert auth modal and recaptures Tab only after verification resumes', async () => {
    await go(viewports[1]!); await page.getByTestId('issue-review').click();
    await page.getByTestId('review-note').fill('Draf sintetis dipertahankan saat verifikasi izin.');
    await page.evaluate(() => {
      (window as any).__retainedReviewNote = document.querySelector('[data-testid="review-note"]');
      (window as any).__frontend.holdVerification();
      (window as any).__frontend.emit('TOKEN_REFRESHED', 'SYNTHETIC_ACCESS_B');
    });
    await page.getByText('Memverifikasi izin akun…', { exact: true }).waitFor();
    expect(await page.getByTestId('detail-modal').isVisible()).toBe(false);
    expect(await page.getByTestId('review-note').evaluate(el => !!el.closest('[hidden][inert]'))).toBe(true);
    await page.getByTestId('review-note').evaluate((el: HTMLTextAreaElement) => el.focus());
    await page.keyboard.press('Escape'); await page.keyboard.press('Tab');
    expect(await page.getByTestId('detail-modal').count()).toBe(1);
    expect(await page.getByTestId('detail-modal').evaluate(el => el.contains(document.activeElement))).toBe(false);
    await page.getByTestId('review-save').evaluate((el: HTMLButtonElement) => el.click());
    expect(await page.evaluate(() => (window as any).__frontend.requests.filter((r: any) => r.method === 'POST').length)).toBe(0);
    await page.screenshot({ path: resolve(evidenceDir, 'auth-checking-private-hidden.png') });
    await page.evaluate(() => (window as any).__frontend.releaseVerification());
    await page.getByTestId('detail-modal').waitFor();
    expect(await page.getByTestId('review-note').inputValue()).toBe('Draf sintetis dipertahankan saat verifikasi izin.');
    expect(await page.getByTestId('review-note').evaluate(el => el === (window as any).__retainedReviewNote)).toBe(true);
    await page.keyboard.press('Tab');
    const focus = await page.evaluate(() => ({ activeTestId: document.activeElement?.getAttribute('data-testid'), activeTag: document.activeElement?.tagName, insideModal: document.querySelector('[data-testid="detail-modal"]')!.contains(document.activeElement), privateTreeHidden: !!document.querySelector('[data-testid="detail-modal"]')!.closest('[hidden], [inert]') }));
    writeFileSync(resolve(evidenceDir, 'auth-resume-focus.json'), JSON.stringify(focus, null, 2));
    expect(focus.insideModal, 'first Tab after a hidden/inert verification must not escape into the page/sidebar').toBe(true);
    expect(focus.privateTreeHidden).toBe(false);
    await page.keyboard.press('Escape'); expect(await page.getByTestId('detail-modal').count()).toBe(0);
  });
  it('returns focus to the page heading if a saved review refetch replaced the original opener', async () => {
    await go(viewports[0]!);
    await page.evaluate(() => { (window as any).__originalReviewOpener = document.querySelector('[data-testid="issue-review"]'); });
    await page.getByTestId('issue-review').click();
    await page.getByTestId('review-status').selectOption('reviewed');
    await page.getByTestId('review-note').fill('Catatan sintetis: keputusan dicatat terpisah dari sumber.');
    await page.getByTestId('review-save').click(); await page.getByTestId('review-success').waitFor();
    await page.getByTestId('data-row').first().waitFor();
    const writes = await page.evaluate(() => (window as any).__frontend.requests.filter((r: any) => r.method === 'POST'));
    expect(writes).toHaveLength(1); expect(writes[0].body).toMatchObject({ snapshotId: 'synthetic-A', status: 'reviewed', note: 'Catatan sintetis: keputusan dicatat terpisah dari sumber.' });
    await page.getByTestId('modal-close').click();
    const focus = await page.evaluate(() => ({ originalOpenerConnected: (window as any).__originalReviewOpener.isConnected, activeId: document.activeElement?.id, activeTag: document.activeElement?.tagName, bodyOverflow: document.body.style.overflow }));
    writeFileSync(resolve(evidenceDir, 'saved-review-focus.json'), JSON.stringify(focus, null, 2));
    expect(focus.originalOpenerConnected).toBe(false);
    expect(focus.activeId, 'a refetched/disconnected opener must not leave keyboard users on body').toBe('page-title');
    expect(focus.bodyOverflow).toBe('');
  });
});
