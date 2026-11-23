import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { WorkspaceShell } from '../../web/components/Shell';
import { FilterForm } from '../../web/components/Filters';
import { exportCsv } from '../../web/lib/export';
import { ApiClient } from '../../web/lib/api';
const viewer = { user: { id: 'test-user', email: 'leader@example.invalid', role: 'leader' as const }, permissions: { viewContact: false, manageData: false, exportDetail: false } };
describe('workspace navigation and query controls', () => {
  it('renders all operational destinations and no admin destination for a leader', () => {
    const html = renderToStaticMarkup(<MemoryRouter><WorkspaceShell me={viewer} onLogout={() => {}}><p>Operational content</p></WorkspaceShell></MemoryRouter>);
    for (const path of ['/', '/rekrutmen', '/kandidat', '/mitra', '/keberangkatan', '/kualitas-data']) expect(html).toContain(`href="${path}"`);
    expect(html).not.toContain('href="/pengaturan"'); expect(html).toContain('Operational content'); expect(html).toContain('data-testid="nav-toggle"'); expect(html).toContain('Lewati ke konten');
  });
  it('renders explicit cohort controls and a real apply action rather than a changing date meaning', () => {
    const html = renderToStaticMarkup(<FilterForm query={{ from: '2026-11-01', status: '__empty__' }} mode="applications" onApply={() => {}} onReset={() => {}}/>);
    expect(html).toContain('Cohort tanggal apply'); expect(html).toContain('data-testid="filter-from"'); expect(html).toContain('Belum diisi'); expect(html).toContain('Terapkan filter');
    expect(html).not.toContain('Periode keberangkatan');
  });
  it('fetches CSV through the bearer API with the exact filters and without contacts or pagination', async () => {
    let url = ''; let token = ''; let saved = '';
    const api = new ApiClient(() => 'export-token', () => {}, async (path, init) => { url = path; token = new Headers(init?.headers).get('Authorization')!; return new Response('snapshotId,unit\ntest,lamaran'); });
    await exportCsv(api, 'applications', { from: '2026-11-01', status: '__empty__', page: '3', limit: '25' }, async (blob, name) => { saved = `${name}:${await blob.text()}`; });
    expect(url).toContain('/api/export?'); expect(url).toContain('kind=applications'); expect(url).toContain('status=__empty__'); expect(url).not.toContain('page='); expect(url).not.toContain('contacts'); expect(token).toBe('Bearer export-token'); expect(saved).toContain('snapshotId');
  });
});
