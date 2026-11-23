import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { OverviewView } from '../../web/pages/Overview';
import { CandidateEvidence } from '../../web/pages/Candidates';
import { FilterForm } from '../../web/components/Filters';
import { ApiClient } from '../../web/lib/api';
import { exportCsv } from '../../web/lib/export';
import { buildQuery, readQuery } from '../../web/lib/query';
import { candidateDetail, meta } from './fixture';

describe('AC-12 displayed snapshot UI binding', () => {
  it('carries DataMeta identity on all KPI scopes, raw month/category/quality and related application links without counting it as a filter', () => {
    const filters = { from: '2025-01-10', to: '2025-01-20', status: 'Closed' };
    const data = { meta: { ...meta, filters }, metrics: [
      { key: 'candidates', label: 'Master', value: 1, unit: 'baris', scope: 'all-time' as const, definition: '' },
      { key: 'applications', label: 'Lamaran', value: 1, unit: 'lamaran', scope: 'apply-cohort' as const, definition: '' },
      { key: 'crew', label: 'Roster', value: 1, unit: 'baris', scope: 'reference' as const, definition: '' },
    ], charts: { monthlyApplications: [{ label: '2025-01', value: 1 }], statuses: [{ label: 'Closed', value: 1 }], results: [{ label: 'Lolos', value: 1 }], workBases: [{ label: 'Darat', value: 1 }], topAgents: [{ label: 'Test Agent', value: 1 }] }, quality: { issueCount: 1, criticalCount: 1, affectedApplications: 1 } };
    const html = renderToStaticMarkup(<MemoryRouter><OverviewView data={data}/></MemoryRouter>);
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map(match => new URL(match[1]!.replaceAll('&amp;', '&'), 'http://test.invalid'));
    expect(hrefs.length).toBe(9);
    for (const href of hrefs) expect(href.searchParams.get('snapshotId'), href.href).toBe(meta.snapshotId);
    expect(hrefs.find(href => href.pathname === '/kandidat')!.searchParams.has('from')).toBe(false);
    expect(hrefs.find(href => href.pathname === '/rekrutmen')!.searchParams.get('from')).toBe(filters.from);
    const related = renderToStaticMarkup(<MemoryRouter><CandidateEvidence data={candidateDetail}/></MemoryRouter>);
    expect(related).toContain('href="/rekrutmen?');
    for (const match of related.matchAll(/href="(\/rekrutmen[^\"]+)"/g)) expect(match[1]).toContain('snapshotId=' + meta.snapshotId);
    const query = { ...filters, snapshotId: meta.snapshotId };
    expect(readQuery(new URLSearchParams(buildQuery(query)))).toEqual(query);
    const form = renderToStaticMarkup(<FilterForm mode="overview" query={query} onApply={() => {}} onReset={() => {}}/>);
    expect(form).toContain('3 aktif'); expect(form).not.toContain('4 aktif');
  });
  it('sends the displayed binding in CSV exactly once and never saves or retries a stale response on latest', async () => {
    const paths: string[] = []; const save = vi.fn();
    const api = new ApiClient(() => 'test', () => {}, async path => { paths.push(path); return new Response(JSON.stringify({ error: { code: 'SNAPSHOT_CHANGED' } }), { status: 409 }); });
    const query = { ...meta.filters, snapshotId: meta.snapshotId, from: '2025-01-10' };
    await expect(exportCsv(api, 'applications', query, save)).rejects.toMatchObject({ status: 409, code: 'SNAPSHOT_CHANGED' });
    expect(paths).toHaveLength(1);
    expect(new URL(paths[0]!, 'http://test.invalid').searchParams.get('snapshotId')).toBe(meta.snapshotId);
    expect(save).not.toHaveBeenCalled();
  });
});
