import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { OverviewView, metricHref } from '../../web/pages/Overview';
import { FilterForm } from '../../web/components/Filters';
import { buildQuery, readQuery } from '../../web/lib/query';
import { exportCsv } from '../../web/lib/export';
import { ApiClient } from '../../web/lib/api';
import { meta } from './fixture';
describe('exact KPI cohort drilldown', () => {
  it('intersects monthly drilldowns and renders unsupported groups without misleading links', () => {
    const data = { meta: { ...meta, filters: { from: '2026-11-10', to: '2026-11-20' } }, metrics: [], charts: { monthlyApplications: [{ label: '2026-11', value: 3 }, { label: 'Tidak diketahui', value: 1 }], statuses: [], results: [], workBases: [], topAgents: [{ label: 'Tidak terpetakan', value: 2 }] }, quality: { issueCount: 0, criticalCount: 0, affectedApplications: 0 } };
    const html = renderToStaticMarkup(<MemoryRouter><OverviewView data={data}/></MemoryRouter>);
    expect(html).toContain('from=2026-11-10&amp;to=2026-11-20');
    expect(html).not.toContain('from=2026-11-01');
    expect(html).not.toContain('agent=Tidak');
    expect(html).toContain('Rincian kelompok belum tersedia');
    expect(html).not.toMatch(/<a[^>]*aria-label="Tidak diketahui/);
    expect(html).not.toMatch(/<a[^>]*aria-label="Tidak terpetakan/);
  });
  it('keeps the existing cohort and carries a visible removable AND constraint through CSV', async () => {
    const filters = { status: 'Closed', metric: 'inProgress', from: '2026-11-10', to: '2026-11-20' };
    const params = new URLSearchParams(buildQuery(filters)); expect(readQuery(params).metric).toBe('inProgress');
    const href = metricHref({ key: 'inProgress', value: 0, unit: 'lamaran', label: 'In Progress', scope: 'apply-cohort', definition: '', filter: filters }, filters);
    expect(href).toContain('status=Closed'); expect(href).toContain('metric=inProgress');
    const html = renderToStaticMarkup(<FilterForm mode="applications" query={filters} onApply={() => {}} onReset={() => {}}/>);
    expect(html).toContain('Batas KPI'); expect(html).toContain('In Progress'); expect(html).toContain('data-testid="clear-metric"');
    let url = ''; await exportCsv(new ApiClient(() => 'test', () => {}, async path => { url = path; return new Response('test'); }), 'applications', filters, () => {});
    expect(url).toContain('metric=inProgress'); expect(url).toContain('status=Closed');
  });
});
