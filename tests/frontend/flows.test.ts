import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import { mkdirSync } from 'node:fs';
import type { AuditListResponse } from '../../shared/contracts';
import { application, candidate, candidateDetail, departure, issue, list, meta, options, partner, settings, status, unmapped } from './fixture';
let vite: ViteDevServer; let browser: Browser; let base: string; let context: BrowserContext; let page: Page;
const pageErrors: string[] = [];
const requests: { method: string; path: string; body: any }[] = [];
let currentSettings = structuredClone(settings); let currentIssue = structuredClone(issue); let mappings: any[] = []; let sourceStatus = structuredClone(status);
const virtualAuth = `import { ApiClient } from '/web/lib/api';
const role = globalThis.__sidaksaTestRole || 'admin';
const me = { user: { id: 'isolated-user', email: 'test@example.invalid', role }, permissions: { manageData: role === 'admin', viewContact: role !== 'leader', exportDetail: role !== 'leader' } };
const auth = { session: { me, token: 'isolated-test-token', phase: 'authorized' }, api: new ApiClient(() => 'isolated-test-token', () => {}), logout: async () => {} };
export const useAuth = () => auth; export const AuthProvider = ({children}) => children; export const ProtectedApp = ({children}) => children;`;
beforeAll(async () => {
  mkdirSync('.private/test-tmp/flows-env', { recursive: true });
  vite = await createServer({ configFile: false, envDir: process.cwd() + '/.private/test-tmp/flows-env', cacheDir: '.private/test-tmp/flows-vite', root: process.cwd(), server: { host: '127.0.0.1', port: 0, strictPort: false }, plugins: [{ name: 'isolated-frontend-test-auth', enforce: 'pre', resolveId(id, importer) { if (importer?.replaceAll('\\', '/').includes('/web/') && /(?:^|\/)auth\/AuthProvider$/.test(id)) return '\0isolated-test-auth'; }, load(id) { if (id === '\0isolated-test-auth') return virtualAuth; }, configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      if (!req.url?.startsWith('/api/')) { if (req.headers.accept?.includes('text/html')) req.url = '/tests/frontend/browser.html'; return next(); }
      const url = new URL(req.url, 'http://isolated.invalid'); let body: any = null;
      if (req.method !== 'GET') { let text = ''; for await (const chunk of req) text += chunk; body = text ? JSON.parse(text) : null; }
      requests.push({ method: req.method!, path: req.url, body });
      let result: unknown;
      if (url.pathname === '/api/status') result = sourceStatus;
      else if (url.pathname === '/api/dictionaries') result = options;
      else if (url.pathname === '/api/applications') result = { ...list([application], Number(url.searchParams.get('page') || 1), 26), meta: { ...meta, filters: Object.fromEntries(url.searchParams) } };
      else if (url.pathname.startsWith('/api/applications/')) result = { row: application, candidate, issues: [currentIssue], meta };
      else if (url.pathname === '/api/candidates') result = list([candidate]);
      else if (url.pathname.startsWith('/api/candidates/')) result = candidateDetail;
      else if (url.pathname === '/api/partners') result = list(url.searchParams.get('kind') === 'companies' ? [{ ...partner, id: 'COMPANY_TEST', kind: 'company', name: '', issueCodes: ['EMPTY_NAME'] }, unmapped] : [partner, unmapped]);
      else if (url.pathname === '/api/departures') result = list([departure]);
      else if (url.pathname === '/api/issues') result = list([currentIssue]);
      else if (url.pathname.endsWith('/review')) { currentIssue = { ...currentIssue, status: body.status, reviewNote: body.note }; result = currentIssue; }
      else if (url.pathname === '/api/settings') { if (req.method === 'PUT') currentSettings = { ...currentSettings, ...body }; result = currentSettings; }
      else if (url.pathname === '/api/mappings') { if (req.method === 'POST') mappings.push({ ...body, id: 'mapping-test', createdAt: meta.createdAt, createdBy: 'isolated-user' }); result = { rows: mappings }; }
      else if (url.pathname === '/api/audit') {
        const audit: AuditListResponse = {
          rows: [{ id: 'audit:test', at: meta.createdAt, actorId: 'isolated-user', action: 'sync', result: 'ok', details: {} }],
          pagination: { page: 1, limit: 25, total: 1, totalPages: 1 },
          meta: { kind: 'audit', generatedAt: meta.createdAt, filters: {}, sourceSnapshot: { snapshotId: meta.snapshotId, source: meta.source, createdAt: meta.createdAt } },
        };
        result = audit;
      }
      else if (url.pathname === '/api/sync') result = sourceStatus;
      else if (url.pathname === '/api/export') { res.setHeader('Content-Type', 'text/csv'); res.end('snapshot_id,unit\nisolated-snapshot,fixture'); return; }
      else { res.statusCode = 404; result = { error: { code: 'NOT_FOUND', message: 'No fixture route' } }; }
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(result));
    });
  } }] });
  await vite.listen(); base = vite.resolvedUrls!.local[0];
  browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--disable-gpu'] });
}, 60000);
beforeEach(async () => { requests.length = 0; currentSettings = structuredClone(settings); currentIssue = structuredClone(issue); mappings = []; sourceStatus = structuredClone(status); context = await browser.newContext(); page = await context.newPage(); page.setDefaultTimeout(8000); pageErrors.length = 0; page.on('pageerror', error => pageErrors.push(error.message)); });
afterEach(async () => { await context?.close(); expect(pageErrors).toEqual([]); });
afterAll(async () => { await context?.close(); await browser?.close(); await vite?.close(); });
async function go(path: string, role = 'admin') { await context.addInitScript(role => { (globalThis as any).__sidaksaTestRole = role; }, role); await page.goto(new URL(path, base).href); }
async function close() { await context.close(); }
async function eventually(check: () => boolean) { for (let i = 0; i < 100; i++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 30)); } expect(check()).toBe(true); }
describe('real browser operational flows (isolated injected fixture API only)', () => {
  it('contains wide tables on mobile and traps drawer focus without losing keyboard navigation', async () => {
    await page.setViewportSize({ width: 1440, height: 1050 }); await go('/rekrutmen'); await page.getByTestId('data-row').first().waitFor();
    mkdirSync('.private/test-tmp/frontend-screens', { recursive: true });
    expect((await page.locator('.table-responsive a.source-link').first().boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: '.private/test-tmp/frontend-screens/rekrutmen-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.locator('.table-responsive[role="region"]').evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
    expect((await page.locator('.table-responsive a.source-link').first().boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.getByTestId('nav-toggle').click();
    const drawer = page.getByRole('dialog', { name: 'Navigasi SIDAKSA' }); await drawer.waitFor();
    expect(await page.locator('.workspace-main').getAttribute('inert')).not.toBeNull();
    await page.keyboard.press('Shift+Tab'); expect(await drawer.locator('a,button').last().evaluate(el => el === document.activeElement)).toBe(true);
    await page.keyboard.press('Tab'); expect(await drawer.locator('a,button').first().evaluate(el => el === document.activeElement)).toBe(true);
    await page.screenshot({ path: '.private/test-tmp/frontend-screens/sidebar-mobile.png', fullPage: true });
    await page.keyboard.press('Escape'); expect(await page.getByTestId('nav-toggle').getAttribute('aria-expanded')).toBe('false');
    expect(await page.getByTestId('nav-toggle').evaluate(el => el === document.activeElement)).toBe(true);
    await close();
  }, 45000);
  it('clears only the visible KPI constraint and keeps the cohort status in subsequent API requests', async () => {
    await go('/rekrutmen?status=Closed&metric=inProgress');
    await page.getByTestId('clear-metric').click();
    await eventually(() => requests.some(r => r.path.startsWith('/api/applications?') && r.path.includes('status=Closed') && !r.path.includes('metric=')));
    expect(new URL(page.url()).searchParams.has('metric')).toBe(false);
    expect(new URL(page.url()).searchParams.get('status')).toBe('Closed');
    await close();
  }, 45000);
  it('distinguishes an empty filtered list, a request failure with retry, and an unconfigured source', async () => {
    let fail = false;
    await page.route('**/api/applications*', route => route.fulfill({ status: fail ? 503 : 200, contentType: 'application/json', body: JSON.stringify(fail ? { error: { code: 'SOURCE_UNAVAILABLE', message: 'sensitive error body' } } : list([])) }));
    await go('/rekrutmen'); await page.getByTestId('state-empty').waitFor();
    expect(await page.locator('main').textContent()).toContain('0 baris');
    fail = true; await page.getByTestId('filter-apply').click(); await page.reload(); await page.getByTestId('state-error').waitFor();
    expect(await page.locator('main').textContent()).not.toContain('sensitive error body');
    fail = false; await page.getByRole('button', { name: 'Coba lagi', exact: true }).click(); await page.getByTestId('state-empty').waitFor();
    sourceStatus.snapshot = null; sourceStatus.sheetsConfigured = false; await page.reload(); await page.getByTestId('state-setup').waitFor();
    expect(await page.getByTestId('state-empty').count()).toBe(0); await close();
  }, 45000);
  it('creates an explicit mapping with unchanged source tokens and verifies the stored decision', async () => {
    await go('/pengaturan#mapping');
    await page.getByTestId('mapping-kind').selectOption('agent');
    await page.getByTestId('mapping-alias').fill('DKDP_014');
    await page.getByTestId('mapping-target').fill('AGENT_TEST');
    await page.getByTestId('mapping-reason').fill('Persetujuan eksplisit pemilik sumber uji.');
    await page.getByTestId('mapping-save').click();
    await page.getByTestId('mapping-success').waitFor();
    const write = requests.find(r => r.method === 'POST' && r.path === '/api/mappings')!;
    expect(write.body).toEqual({ kind: 'agent', alias: 'DKDP_014', targetId: 'AGENT_TEST', reason: 'Persetujuan eksplisit pemilik sumber uji.', snapshotId: meta.snapshotId });
    expect(requests.slice(requests.indexOf(write) + 1).some(r => r.method === 'GET' && r.path === '/api/mappings')).toBe(true);
    await page.getByTestId('mapping-list').getByText('DKDP_014', { exact: true }).waitFor();
    await close();
  }, 45000);
  it('saves only approved reference and schedule fields, verifies settings, and performs a manual sync', async () => {
    await go('/pengaturan');
    await page.getByTestId('settings-interval').fill('20');
    await page.getByTestId('settings-retention').fill('45');
    await page.getByTestId('reference-funnel').check();
    await page.getByTestId('settings-save').click();
    await page.getByTestId('settings-success').waitFor();
    const write = requests.find(r => r.method === 'PUT' && r.path === '/api/settings')!;
    expect(write.body).toEqual({ referenceTabs: ['Crew List Departure', 'Funnel Rekap'], syncIntervalMinutes: 20, retentionDays: 45 });
    expect(requests.slice(requests.indexOf(write) + 1).some(r => r.method === 'GET' && r.path === '/api/settings')).toBe(true);
    await page.getByTestId('manual-sync').click(); await page.getByTestId('sync-result').waitFor();
    expect(requests.some(r => r.method === 'POST' && r.path === '/api/sync' && JSON.stringify(r.body) === '{}')).toBe(true);
    expect(await page.locator('main').textContent()).toContain('Data Kandidat');
    await page.getByText('audit:test', { exact: true }).waitFor();
    const auditMetadata = await page.getByTestId('audit-metadata').textContent();
    expect(auditMetadata).toContain(meta.snapshotId);
    expect(auditMetadata).not.toContain('Belum tersedia');
    await close();
  }, 45000);
  it('reviews data against the exact snapshot and reads it back before reporting success', async () => {
    await go('/kualitas-data');
    await page.getByTestId('filter-severity').selectOption('critical');
    await page.getByTestId('filter-code').selectOption(issue.code);
    await page.getByTestId('filter-apply').click();
    await page.getByTestId('issue-review').first().click();
    await page.getByTestId('review-status').selectOption('reviewed');
    await page.getByTestId('review-note').fill('Diperiksa pada sumber uji.');
    await page.getByTestId('review-save').click();
    await page.getByTestId('review-success').waitFor();
    expect(await page.getByTestId('detail-modal').locator('dd').allTextContents()).toContain('Ditinjau');
    const write = requests.find(r => r.method === 'POST' && r.path.endsWith('/review'))!;
    expect(write.body).toEqual({ status: 'reviewed', note: 'Diperiksa pada sumber uji.', snapshotId: meta.snapshotId });
    expect(requests.slice(requests.indexOf(write) + 1).some(r => r.method === 'GET' && r.path.startsWith('/api/issues'))).toBe(true);
    expect(await page.getByTestId('detail-modal').getByRole('link', { name: /mapping eksplisit/ }).getAttribute('href')).toContain('/pengaturan');
    await close();
  }, 45000);
  it('treats unapproved departure references as unavailable, then filters only the record dates when approved', async () => {
    sourceStatus.referenceTabs = []; sourceStatus.snapshot!.counts.crewRows = null;
    await go('/keberangkatan');
    await page.getByTestId('departures-unavailable').waitFor();
    expect(await page.getByTestId('departures-unavailable').textContent()).toContain('bukan nol');
    expect(requests.some(r => r.path.startsWith('/api/departures'))).toBe(false);
    sourceStatus = structuredClone(status); await page.reload();
    await page.getByTestId('filter-from').fill('2026-11-01'); await page.getByTestId('filter-to').fill('2026-11-30'); await page.getByTestId('filter-apply').click();
    await eventually(() => requests.some(r => r.path.startsWith('/api/departures?') && r.path.includes('from=2026-11-01')));
    await page.getByText('November 2026', { exact: true }).waitFor();
    expect(await page.locator('main').textContent()).toContain('Bulan saja');
    expect(await page.locator('main').textContent()).toContain('Belum terkonfirmasi');
    expect(await page.locator('main').textContent()).not.toContain('Cohort tanggal apply');
    await close();
  }, 45000);
  it('switches partner masters without conflating company source rows, IDs or unknown results and exports the selected kind', async () => {
    await go('/mitra');
    await page.getByTestId('partner-companies').click();
    await eventually(() => requests.some(r => r.path.includes('/api/partners?') && r.path.includes('kind=companies')));
    await page.getByText('2 baris company', { exact: false }).waitFor();
    expect(await page.locator('main').textContent()).toContain('1 ID berbeda');
    expect(await page.locator('main').textContent()).toContain('1 nama kosong');
    // Summary and bound collection load independently; wait for the actual table, not merely its summary.
    await page.getByText('Hasil belum diisi', { exact: false }).first().waitFor();
    expect(await page.locator('main').textContent()).toContain('Hasil belum diisi');
    expect(await page.locator('main').textContent()).toContain('Tidak terpetakan');
    expect(await page.locator('a[href*="A0"]').count()).toBe(0);
    const download = page.waitForEvent('download'); await page.getByTestId('export-partners').click(); await download;
    await eventually(() => requests.some(r => r.path.includes('/api/export?') && r.path.includes('kind=partners') && r.path.includes('partnerKind=companies')));
    await close();
  }, 45000);
  it('opens every candidate application but never renders forbidden contacts or loads photographs', async () => {
    await go('/kandidat', 'leader');
    await page.getByTestId('filter-q').fill('TEST_01');
    await page.getByTestId('filter-year').selectOption('2025');
    await page.getByTestId('filter-apply').click();
    await eventually(() => requests.some(r => r.path.includes('/api/candidates?') && r.path.includes('year=2025') && r.path.includes('q=TEST_01')));
    await page.getByTestId('candidate-detail').first().click();
    const modal = page.getByTestId('detail-modal'); await modal.getByText('Posisi lamaran kedua').waitFor();
    expect(await modal.textContent()).toContain('2 lamaran terkait');
    expect(await modal.textContent()).not.toContain('TEST-CONTACT');
    expect(await modal.textContent()).not.toContain('Catatan privat');
    expect(await modal.locator('img').count()).toBe(0);
    expect(await modal.getByRole('link', { name: /Buka foto/ }).count()).toBe(0);
    expect(await page.getByTestId('export-candidates').isDisabled()).toBe(true);
    await close();
  }, 45000);
  it('filters, sorts, paginates and opens evidence for an application without inventing departure', async () => {
    await go('/rekrutmen');
    await page.getByTestId('filter-q').fill('Kandidat');
    await page.getByTestId('filter-from').fill('2026-11-01');
    await page.getByTestId('filter-more').click();
    await page.getByTestId('filter-status').selectOption('__empty__');
    await page.getByTestId('filter-apply').click();
    await eventually(() => requests.some(r => r.path.includes('/api/applications?') && r.path.includes('q=Kandidat') && r.path.includes('status=__empty__')));
    await page.getByTestId('sort-candidateName').click();
    await page.getByTestId('page-next').click();
    await eventually(() => requests.some(r => r.path.includes('page=2') && r.path.includes('sort=candidateName')));
    await page.getByTestId('application-detail').first().click();
    const modal = page.getByTestId('detail-modal');
    await modal.getByText('November 2026', { exact: true }).first().waitFor();
    expect(await modal.textContent()).toContain('Completed tidak berarti berangkat');
    expect(await modal.getByRole('link', { name: /Proses Rekrutment!B597/ }).first().getAttribute('href')).toContain('B597');
    await page.keyboard.press('Escape'); expect(await modal.count()).toBe(0);
    expect(await page.getByTestId('application-detail').first().evaluate(el => el === document.activeElement)).toBe(true);
    await close();
  }, 60000);
});
