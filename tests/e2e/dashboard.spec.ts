import { test, expect, type Page } from '@playwright/test';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import type { Role } from '../../shared/contracts';
import { AUTH_URL, FIXTURE_URL, PUBLIC_URL, TOKENS, USERS, SNAPSHOT_CONTROL_FILE } from './fixture-data';

const evidence = path.resolve('.private/evidence');
const errors = new WeakMap<Page, string[]>();
test.describe.configure({ mode: 'serial' });
test.beforeEach(async ({ page }) => {
  const messages: string[] = []; errors.set(page, messages);
  page.on('pageerror', error => messages.push(error.message));
  await mkdir(evidence, { recursive: true });
});
test.afterEach(async ({ page }) => { expect(errors.get(page)).toEqual([]); });

async function signIn(page: Page, role: Role) {
  // The ONLY mocked service is fictitious Supabase Auth. SIDAKSA APIs are real HTTP.
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if ([FIXTURE_URL, PUBLIC_URL].includes(url.origin)) return route.continue();
    if (url.origin !== AUTH_URL) return route.abort('blockedbyclient');
    if (url.pathname.endsWith('/logout')) return route.fulfill({ status: 204 });
    const user = { ...USERS[role], aud: 'authenticated', role: 'authenticated', created_at: '2026-01-01T00:00:00Z',
      // Deliberately claims admin for EVERY role; UI must trust /api/me, not this.
      app_metadata: { provider: 'email', providers: ['email'], sidaksa_approved: true, sidaksa_role: 'admin' }, user_metadata: { sidaksa_role: 'admin' } };
    if (url.pathname.endsWith('/user')) return route.fulfill({ json: user });
    if (url.pathname.endsWith('/token')) return route.fulfill({ json: {
      access_token: TOKENS[role], refresh_token: `TEST_ONLY_REFRESH_${role}`, token_type: 'bearer',
      expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user,
    } });
    return route.abort('blockedbyclient');
  });
  await page.goto(FIXTURE_URL);
  await expect(page.getByTestId('login-email')).toBeEnabled();
  expect(new URL(page.url()).origin).toBe(FIXTURE_URL);
  await page.getByTestId('login-email').fill(USERS[role].email);
  await page.getByTestId('login-password').fill('FICTITIOUS_TEST_PASSWORD_ONLY');
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('overview-metrics')).toBeVisible();
  await expect(page.getByTestId('source-status')).toContainText('SUMBER UJI');
}
async function get(page: Page, target: string, role: Role) {
  expect(new URL(target, FIXTURE_URL).origin).toBe(FIXTURE_URL);
  return page.request.get(FIXTURE_URL + target, { headers: { Authorization: `Bearer ${TOKENS[role]}` } });
}
async function csvFromDownload(page: Page, testId: string) {
  const pending = page.waitForEvent('download');
  await page.getByTestId(testId).click();
  const download = await pending;
  const file = await download.path();
  expect(file).toBeTruthy();
  return readFile(file!, 'utf8');
}

test('unconfigured application is honest and denies anonymous/private access', async ({ page, request }) => {
  await page.goto(PUBLIC_URL);
  await expect(page.getByTestId('auth-setup')).toContainText('Konfigurasi login belum tersedia');
  await expect(page.getByTestId('login-submit')).toBeDisabled();
  await expect(page.getByTestId('overview-metrics')).toHaveCount(0);
  expect((await request.get(PUBLIC_URL + '/api/overview')).status()).toBe(401);
  for (const suffix of ['/.env', '/.private/data/state.json', '/%2eprivate/data/state.json', '/@fs/D:/sidaksa/.private/fixtures/source.json', '/server/auth.ts']) {
    expect((await request.get(PUBLIC_URL + suffix)).status()).toBe(404);
  }
  await page.screenshot({ path: path.join(evidence, 'login-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId('auth-setup')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: path.join(evidence, 'login-mobile.png'), fullPage: true });
});

test('recruiter follows KPIs, precision-safe filters, details, related applications and CSV', async ({ page }) => {
  await signIn(page, 'recruiter');
  await expect(page.getByTestId('metric-applications').locator('.metric-value')).toContainText('3');
  await expect(page.getByTestId('nav-pengaturan')).toHaveCount(0);
  await page.screenshot({ path: path.join(evidence, 'overview-fixture.png'), fullPage: true });
  await page.getByTestId('metric-emptyStatus').click();
  await expect(page.getByTestId('data-row')).toHaveCount(1);
  await expect(page.getByTestId('filter-form')).toContainText('Batas KPI');
  const csv = await csvFromDownload(page, 'export-applications');
  expect(csv.trim().split('\r\n')).toHaveLength(2);
  expect(csv).toContain('"fixture"'); expect(csv).not.toContain('[object Object]');
  expect(csv).not.toContain('081-PRIVATE');
  await page.getByTestId('filter-reset').click();
  await expect(page.getByTestId('data-row')).toHaveCount(3);
  await page.getByTestId('filter-from').fill('2025-01-10');
  await page.getByTestId('filter-to').fill('2025-01-20');
  await page.getByTestId('filter-apply').click();
  await expect(page.getByTestId('data-row')).toHaveCount(1);
  await expect(page.locator('.precision-warning')).toContainText('1 baris tidak tercakup');
  await page.getByTestId('application-detail').first().click();
  await expect(page.getByTestId('detail-modal')).toContainText('Rincian lamaran');
  await expect(page.getByTestId('detail-modal')).toContainText('081-PRIVATE');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('detail-modal')).toHaveCount(0);
  await page.getByTestId('nav-kandidat').click();
  await expect(page.getByTestId('data-row')).toHaveCount(2);
  await page.getByTestId('candidate-detail').first().click();
  await expect(page.getByTestId('detail-modal')).toContainText('Test Person');
  await expect(page.getByTestId('detail-modal').getByTestId('data-row')).toHaveCount(2);
  await page.keyboard.press('Escape');
  await page.getByTestId('nav-mitra').click();
  await expect(page.locator('#page-title')).toContainText('Mitra');
  await expect(page.locator('.table-panel')).toContainText('Tidak terpetakan');
  await page.getByTestId('nav-keberangkatan').click();
  await expect(page.getByTestId('data-row')).toHaveCount(1);
  await expect(page.locator('main')).toContainText('Menunggu');
  await page.getByTestId('nav-kualitas-data').click();
  await expect(page.locator('.table-panel')).toContainText('CANDIDATE_NOT_FOUND');
  await page.getByTestId('logout').click();
  await expect(page.getByTestId('login-form')).toBeVisible();
  await expect(page.getByTestId('overview-metrics')).toHaveCount(0);
  expect(await page.locator('body').innerText()).not.toContain('081-PRIVATE');
});

test('mobile navigation traps focus and tables remain inside the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, 'recruiter');
  await page.getByTestId('nav-toggle').click();
  await expect(page.getByRole('dialog', { name: 'Navigasi SIDAKSA' })).toBeVisible();
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.getElementById('main-sidebar')!.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('nav-toggle')).toBeFocused();
  await page.getByTestId('nav-toggle').click();
  await page.getByTestId('nav-rekrutmen').click();
  await expect(page.getByTestId('data-row')).toHaveCount(3);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const region = page.locator('.table-responsive[role="region"][aria-label="Daftar lamaran"]');
  await expect(region).toBeVisible();
  expect(await region.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
  await page.screenshot({ path: path.join(evidence, 'rekrutmen-mobile-fixture.png'), fullPage: true });
});

test('admin persists settings, explicit mapping, review, audit and last-good failure state', async ({ page }) => {
  await signIn(page, 'admin');
  await page.getByTestId('nav-pengaturan').click();
  await page.getByTestId('settings-interval').fill('20');
  await page.getByTestId('settings-retention').fill('14');
  await page.getByTestId('settings-save').click();
  await expect(page.getByTestId('settings-success')).toBeVisible();
  expect(await (await get(page, '/api/settings', 'admin')).json()).toMatchObject({ syncIntervalMinutes: 20, retentionDays: 14 });
  await page.getByTestId('mapping-alias').fill('Test Agent Alias');
  await page.getByTestId('mapping-target').fill('AG_1');
  await page.getByTestId('mapping-reason').fill('TEST_ONLY_EXPLICIT_REVIEW');
  await page.getByTestId('mapping-save').click();
  await expect.poll(async () => (await (await get(page, '/api/mappings', 'admin')).json()).rows.length).toBe(1);
  await page.getByTestId('nav-kualitas-data').click();
  await page.getByTestId('filter-code').selectOption('CANDIDATE_NOT_FOUND');
  await page.getByTestId('filter-apply').click();
  await expect(page.getByTestId('data-row')).toHaveCount(1);
  await page.getByTestId('issue-review').click();
  await page.getByTestId('review-status').selectOption('reviewed');
  await page.getByTestId('review-note').fill('TEST_ONLY_REVIEW_NOTE');
  await page.getByTestId('review-save').click();
  await expect(page.getByTestId('review-success')).toBeVisible();
  const issues = await (await get(page, '/api/issues?code=CANDIDATE_NOT_FOUND', 'admin')).json();
  expect(issues.rows[0]).toMatchObject({ status: 'reviewed', reviewNote: 'TEST_ONLY_REVIEW_NOTE' });
  await page.keyboard.press('Escape');
  await page.getByTestId('nav-pengaturan').click();
  const previous = await (await get(page, '/api/status', 'admin')).json();
  await page.getByTestId('manual-sync').click();
  await expect(page.getByTestId('source-status')).toContainText('Sinkronisasi gagal');
  const failed = await (await get(page, '/api/status', 'admin')).json();
  expect(failed.sync.state).toBe('failed'); expect(failed.snapshot.id).toBe(previous.snapshot.id);
  expect(failed.snapshot.counts.applications).toBe(3);
  const audit = await (await get(page, '/api/audit?limit=100', 'admin')).json();
  expect(audit.rows.map((row: { action: string }) => row.action)).toEqual(expect.arrayContaining(['settings.update', 'mapping.publish']));
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(evidence, 'settings-fixture.png'), fullPage: true });
});

test('leader ignores spoofed client role and never receives protected fields', async ({ page }) => {
  await signIn(page, 'leader');
  await expect(page.getByTestId('nav-pengaturan')).toHaveCount(0);
  await expect(page.getByTestId('source-status')).toContainText('snapshot terakhir');
  for (const endpoint of ['/api/candidates', '/api/applications', '/api/issues', '/api/partners?kind=agents']) {
    const response = await get(page, endpoint, 'leader'); expect(response.status()).toBe(200);
    expect(await response.text()).not.toMatch(/081-PRIVATE|TEST_PRIVATE_CONTACT|private application notes|TEST_ONLY_REVIEW_NOTE|photo-private/);
  }
  expect((await get(page, '/api/settings', 'leader')).status()).toBe(403);
  expect((await get(page, '/api/export?kind=applications', 'leader')).status()).toBe(403);
  const aggregate = await csvFromDownload(page, 'export-aggregate'); expect(aggregate).toContain('snapshot_id');
  await page.getByTestId('nav-rekrutmen').click();
  await expect(page.getByTestId('export-applications')).toBeDisabled();
  await page.getByTestId('application-detail').first().click();
  expect(await page.getByTestId('detail-modal').innerText()).not.toContain('081-PRIVATE');
  await page.keyboard.press('Escape');
  await page.goto(FIXTURE_URL + '/pengaturan');
  await expect(page.locator('#page-title')).toHaveText('Akses admin diperlukan');
});

test('AC-12 publication between display and export/drilldown/details requires explicit latest without retrying CSV', async ({ page, browser }) => {
  test.setTimeout(90000);
  const applications = await browser.newPage(); const candidates = await browser.newPage();
  for (const detailPage of [applications, candidates]) detailPage.on('pageerror', error => errors.get(page)!.push(error.message));
  let downloads = 0; page.on('download', () => downloads++);
  let exports = 0; page.on('request', request => { if (new URL(request.url()).pathname === '/api/export') exports++; });
  try {
    await signIn(page, 'recruiter');
    await page.goto(FIXTURE_URL + '/?from=2025-01-10&to=2025-01-20');
    await expect(page.getByTestId('metric-applications').locator('.metric-value')).toContainText('1');
    const initial = (await (await get(page, '/api/overview', 'recruiter')).json()).meta.snapshotId;
    await signIn(applications, 'recruiter');
    await applications.goto(FIXTURE_URL + '/rekrutmen?from=2025-01-10&to=2025-01-20&status=In+Progress');
    await expect(applications.getByTestId('data-row')).toHaveCount(1);
    await signIn(candidates, 'recruiter');
    await candidates.goto(FIXTURE_URL + '/kandidat?year=2025');
    await expect(candidates.getByTestId('data-row')).toHaveCount(1);
    await expect.poll(() => new URL(page.url()).searchParams.get('snapshotId')).toBe(initial);
    await expect.poll(() => new URL(applications.url()).searchParams.get('snapshotId')).toBe(initial);
    await expect.poll(() => new URL(candidates.url()).searchParams.get('snapshotId')).toBe(initial);
    await candidates.goto(FIXTURE_URL + '/kandidat?snapshotId=' + encodeURIComponent(initial));
    await expect(candidates.getByTestId('data-row')).toHaveCount(2);
    await candidates.getByTestId('candidate-detail').first().click();
    await expect(candidates.getByTestId('detail-modal').locator('a.table-detail').first()).toBeVisible();
    const relatedHref = await candidates.getByTestId('detail-modal').locator('a.table-detail').first().getAttribute('href');
    expect(new URL(relatedHref!, FIXTURE_URL).searchParams.get('snapshotId')).toBe(initial);
    await candidates.keyboard.press('Escape');
    await candidates.goto(FIXTURE_URL + '/kandidat?year=2025&snapshotId=' + encodeURIComponent(initial));
    await expect(candidates.getByTestId('data-row')).toHaveCount(1);
    await page.goto(FIXTURE_URL + '/mitra?snapshotId=' + encodeURIComponent(initial));
    await page.getByTestId('partner-detail').first().click();
    const partnerQualityHref = await page.getByTestId('detail-modal').getByRole('link', { name: 'Tinjau masalah ID sumber' }).getAttribute('href');
    expect(new URL(partnerQualityHref!, FIXTURE_URL).searchParams.get('snapshotId')).toBe(initial);
    await page.keyboard.press('Escape');
    await page.goto(FIXTURE_URL + '/kualitas-data?code=CANDIDATE_NOT_FOUND&snapshotId=' + encodeURIComponent(initial));
    await page.getByTestId('issue-review').click();
    const issueEntityHref = await page.getByTestId('detail-modal').getByRole('link', { name: 'Lihat entitas terdampak' }).getAttribute('href');
    expect(new URL(issueEntityHref!, FIXTURE_URL).searchParams.get('snapshotId')).toBe(initial);
    await page.keyboard.press('Escape');
    await page.goto(FIXTURE_URL + '/?from=2025-01-10&to=2025-01-20&snapshotId=' + encodeURIComponent(initial));
    await expect(page.getByTestId('metric-applications').locator('.metric-value')).toContainText('1');
    await writeFile(SNAPSHOT_CONTROL_FILE, JSON.stringify({ revision: 1 }), { mode: 0o600 });
    const published = await page.request.post(FIXTURE_URL + '/api/sync', { headers: { Authorization: `Bearer ${TOKENS.admin}`, Origin: FIXTURE_URL }, data: {} });
    expect(published.status()).toBe(200);
    const latest = (await published.json()).snapshot.id;
    expect(latest).not.toBe(initial);
    const pending = page.waitForResponse(response => new URL(response.url()).pathname === '/api/export');
    await page.getByTestId('export-aggregate').click(); const rejected = await pending;
    expect(rejected.status()).toBe(409);
    expect(await rejected.json()).toMatchObject({ error: { code: 'SNAPSHOT_CHANGED' } });
    expect(new URL(rejected.url()).searchParams.get('snapshotId')).toBe(initial);
    await expect(page.getByRole('button', { name: 'Muat data terbaru', exact: true })).toBeVisible();
    await expect(page.getByTestId('metric-applications').locator('.metric-value')).toContainText('1');
    expect(downloads).toBe(0); expect(exports).toBe(1);
    await page.screenshot({ path: path.join(evidence, 'snapshot-consistency-stale-export.png'), fullPage: true });
    const boundLinks = await page.locator('.metric-grid a, .charts-grid a, .overview-quality a').evaluateAll(links => links.map(link => (link as HTMLAnchorElement).href));
    for (const href of boundLinks) expect(new URL(href).searchParams.get('snapshotId')).toBe(initial);
    const masterHref = await page.getByTestId('metric-candidates').getAttribute('href');
    expect(new URL(masterHref!, FIXTURE_URL).searchParams.get('snapshotId')).toBe(initial);
    expect(new URL(masterHref!, FIXTURE_URL).searchParams.has('from')).toBe(false);
    const monthlyHref = await page.locator('.chart-monthly a').first().getAttribute('href');
    expect(new URL(monthlyHref!, FIXTURE_URL).searchParams.get('snapshotId')).toBe(initial);
    expect(new URL(monthlyHref!, FIXTURE_URL).searchParams.get('from')).toBe('2025-01-10');
    const detailPending = applications.waitForResponse(response => /\/api\/applications\//.test(new URL(response.url()).pathname));
    await applications.getByTestId('application-detail').click();
    const detail = await detailPending; expect(detail.status()).toBe(409);
    expect(new URL(detail.url()).searchParams.get('snapshotId')).toBe(initial);
    await expect(applications.getByTestId('detail-modal')).toContainText('Snapshot telah berubah');
    await applications.getByTestId('detail-modal').getByRole('button', { name: 'Muat data terbaru', exact: true }).click();
    await expect(applications.getByTestId('detail-modal')).toHaveCount(0);
    await expect(applications.getByTestId('data-row')).toHaveCount(2);
    expect(new URL(applications.url()).searchParams.get('status')).toBe('In Progress');
    expect(new URL(applications.url()).searchParams.get('from')).toBe('2025-01-10');
    const candidatePending = candidates.waitForResponse(response => /\/api\/candidates\//.test(new URL(response.url()).pathname));
    await candidates.getByTestId('candidate-detail').click();
    const candidateResponse = await candidatePending; expect(candidateResponse.status()).toBe(409);
    expect(new URL(candidateResponse.url()).searchParams.get('snapshotId')).toBe(initial);
    await candidates.getByTestId('detail-modal').getByRole('button', { name: 'Muat data terbaru', exact: true }).click();
    await expect(candidates.getByTestId('detail-modal')).toHaveCount(0);
    await expect(candidates.getByTestId('data-row')).toHaveCount(1);
    expect(new URL(candidates.url()).searchParams.get('year')).toBe('2025');
    await page.getByRole('button', { name: 'Muat data terbaru', exact: true }).click();
    await expect(page.getByTestId('metric-applications').locator('.metric-value')).toContainText('2');
    await expect(page.locator('.meta-line')).toContainText(latest);
    await expect(page.getByTestId('source-status')).toContainText(latest);
    expect(exports).toBe(1); expect(downloads).toBe(0);
    expect(new URL(page.url()).searchParams.get('from')).toBe('2025-01-10');
    const csv = await csvFromDownload(page, 'export-aggregate'); expect(csv).toContain(latest); expect(exports).toBe(2);
    for (const href of [relatedHref, partnerQualityHref, issueEntityHref]) {
      await page.goto(FIXTURE_URL + href);
      await expect(page.getByTestId('state-error')).toContainText('Snapshot telah berubah');
      expect(new URL(page.url()).searchParams.get('snapshotId')).toBe(initial);
    }
    await page.goto(FIXTURE_URL + masterHref);
    await expect(page.getByTestId('state-error')).toContainText('Snapshot telah berubah');
    await page.getByRole('button', { name: 'Muat data terbaru', exact: true }).click();
    await expect(page.getByTestId('data-row')).toHaveCount(2);
    await page.goto(FIXTURE_URL + monthlyHref);
    await expect(page.getByTestId('state-error')).toContainText('Snapshot telah berubah');
    await page.getByRole('button', { name: 'Muat data terbaru', exact: true }).click();
    await expect(page.getByTestId('data-row')).toHaveCount(2);
    await page.screenshot({ path: path.join(evidence, 'snapshot-consistency-latest.png'), fullPage: true });
    await writeFile(path.join(evidence, 'snapshot-http-browser.json'), JSON.stringify({ source: 'synthetic injected workbook', transport: 'real SIDAKSA HTTP; only Supabase Auth mocked', initialSnapshotId: initial, latestSnapshotId: latest, staleExportStatus: rejected.status(), applicationDetailStatus: detail.status(), candidateDetailStatus: candidateResponse.status(), exportRequests: exports, successfulDownloads: downloads, boundOverviewLinks: boundLinks.length, staleRelatedLinks: 3, preservedFilters: ['from', 'to', 'status', 'year'], explicitLatestRequired: true, originalFlowsPreserved: 5 }, null, 2));
  } finally { await applications.close(); await candidates.close(); await rm(SNAPSHOT_CONTROL_FILE, { force: true }); }
});

test('UI-01 shared detail and review dialogs are opaque, operable and contained on desktop and mobile', async ({ page }) => {
  test.setTimeout(120000);
  await signIn(page, 'admin');
  const phase = process.env.SIDAKSA_UI_EVIDENCE_PHASE === 'red' ? 'before' : 'after';
  const navigate = async (name: string) => {
    if (await page.getByTestId('nav-toggle').isVisible()) await page.getByTestId('nav-toggle').click();
    await page.getByTestId(`nav-${name}`).click();
    await expect(page.getByTestId('data-row').first()).toBeVisible();
  };
  const surface = async (kind: string, width: number) => {
    const modal = page.getByTestId('detail-modal');
    await expect(modal).toBeVisible();
    await page.screenshot({ path: path.join(evidence, `modal-app-${kind}-${width}-${phase}-20261123.png`), fullPage: false });
    const style = await modal.locator('.modal-content').evaluate(element => {
      const css = getComputedStyle(element), rect = element.getBoundingClientRect();
      return { background: css.backgroundColor, opacity: css.opacity, left: rect.left, right: rect.right, viewport: innerWidth };
    });
    expect(style.background).toBe('rgb(255, 255, 255)');
    expect(style.opacity).toBe('1');
    expect(style.left).toBeGreaterThanOrEqual(0);
    expect(style.right).toBeLessThanOrEqual(style.viewport);
    const close = modal.getByTestId('modal-close');
    await expect(close).toBeVisible();
    expect(await close.evaluate(button => {
      const box = button.getBoundingClientRect();
      return button.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
    })).toBe(true);
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');
  };
  for (const viewport of [{ width: 1572, height: 988 }, { width: 390, height: 844 }, { width: 320, height: 568 }]) {
    await page.setViewportSize(viewport);
    await navigate('rekrutmen');
    const application = page.getByTestId('application-detail').first();
    await application.click(); await surface('application', viewport.width);
    await page.getByTestId('modal-close').click();
    await expect(page.getByTestId('detail-modal')).toHaveCount(0); await expect(application).toBeFocused();

    await navigate('kandidat');
    const candidate = page.getByTestId('candidate-detail').first();
    await candidate.click(); await surface('candidate', viewport.width);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('detail-modal')).toHaveCount(0); await expect(candidate).toBeFocused();

    await navigate('kualitas-data');
    await page.getByTestId('filter-code').selectOption('CANDIDATE_NOT_FOUND');
    await page.getByTestId('filter-apply').click();
    const review = page.getByTestId('issue-review').first(); await review.click();
    await surface('review', viewport.width);
    await page.getByTestId('review-status').selectOption('reviewed');
    await page.getByTestId('review-note').fill('TEST_ONLY_REVIEW_NOTE');
    await page.getByTestId('review-save').click();
    await expect(page.getByTestId('review-success')).toBeVisible();
    await page.screenshot({ path: path.join(evidence, `modal-app-review-saved-${viewport.width}-${phase}-20261123.png`), fullPage: false });
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('detail-modal')).toHaveCount(0);
    // Saving refetches the collection and may replace the opener; the page heading
    // is the shared dialog's deliberate accessible fallback in that case.
    expect(await page.evaluate(() => document.activeElement?.matches('[data-testid="issue-review"], #page-title'))).toBe(true);
    expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
    expect(new URL(page.url()).origin).toBe(FIXTURE_URL);
  }
});
