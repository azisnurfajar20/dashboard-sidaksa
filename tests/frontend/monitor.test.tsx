import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { SourceBanner, DataState, DateCell, Modal } from '../../web/components/ui';
import { OverviewView, metricHref } from '../../web/pages/Overview';
import type { AppStatus, OverviewResponse } from '../../shared/contracts';
const status: AppStatus = { sourceMode: 'google-sheets', authConfigured: true, sheetsConfigured: true, spreadsheetId: 'test_sheet', requiredTabs: [], referenceTabs: [], sync: { state: 'failed', lastAttemptAt: '2026-11-09T02:00:00Z', lastSuccessAt: '2026-11-09T01:00:00Z', nextRunAt: null, message: 'internal secret not for display' }, snapshot: { id: 'test-snapshot', source: 'google-sheets', createdAt: '2026-11-09T01:00:00Z', counts: { candidates: 0, applications: 0, agents: 0, companyRows: 0, companyUniqueIds: 0, companyMissingNames: 0, crewRows: null, funnelRows: null }, issueCount: 0 } };
const overview: OverviewResponse = { meta: { snapshotId: 'test-snapshot', createdAt: '2026-11-09T01:00:00Z', source: 'google-sheets', filters: {}, excludedDatePrecision: 2 }, metrics: [{ key: 'candidates', label: 'Master kandidat', value: 0, unit: 'kandidat', scope: 'all-time', definition: 'Seluruh master tervalidasi.' }, { key: 'crew', label: 'Catatan crew', value: null, unit: 'entri', scope: 'reference', definition: 'Bukan keberangkatan aktual.' }], charts: { monthlyApplications: [{ label: '2026-11', value: 3 }], statuses: [{ label: 'Belum diisi', value: 2 }], results: [], workBases: [], topAgents: [] }, quality: { issueCount: 0, criticalCount: 0, affectedApplications: 0 } };
function render(element: React.ReactNode) { return renderToStaticMarkup(<MemoryRouter>{element}</MemoryRouter>); }
describe('monitor render semantics', () => {
  it('retains last-good snapshot provenance on sync failure without exposing raw backend messages', () => {
    const html = render(<SourceBanner status={status}/>);
    expect(html).toContain('Sinkronisasi gagal'); expect(html).toContain('test-snapshot'); expect(html).toContain('08.00'); expect(html).not.toContain('internal secret');
  });
  it('executes the real overview with valid zero, unavailable references, accessible data charts and scope', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const html = render(<OverviewView data={overview}/>);
    expect(html).toContain('Seluruh master'); expect(html).toContain('data-testid="metric-candidates"'); expect(html).toContain('>0<');
    expect(html).toContain('Belum tersedia'); expect(html).toContain('2 baris'); expect(html).toContain('Belum diisi'); expect(html).toContain('aria-label="Lamaran per bulan apply"');
    expect(errors).not.toHaveBeenCalled();
  });
  it('drills into the exact cohort filter and keeps empty status explicit', () => {
    const metric = { key: 'blankStatus', label: 'Belum diisi', value: 2, unit: 'lamaran', scope: 'apply-cohort' as const, definition: '', filter: { status: '__empty__' } };
    const href = metricHref(metric, { from: '2026-11-01', to: '2026-11-30' });
    expect(href).toContain('status=__empty__'); expect(href).toContain('from=2026-11-01');
    expect(metricHref(overview.metrics[0], { from: '2026-11-01' })).toBe('/kandidat');
  });
  it('separates loading, empty, setup and error from valid results', () => {
    expect(render(<DataState state="loading"/>)).toContain('Memuat'); expect(render(<DataState state="empty"/>)).toContain('Tidak ada hasil');
    expect(render(<DataState state="setup"/>)).toContain('Belum ada snapshot'); expect(render(<DataState state="error" message="Jaringan gagal"/>)).toContain('Jaringan gagal');
    expect(render(<DateCell date={{ raw: '2026-11', iso: '2026-11', display: 'November 2026', precision: 'month' }}/>)).toContain('Bulan saja');
    expect(render(<Modal title="Rincian" onClose={() => {}}>Bukti saat ini</Modal>)).toContain('aria-modal="true"');
  });
});
