import { useEffect, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { DataIssue, DataMeta, ListResponse } from '../../shared/contracts';
import { useWorkspace } from './Shell';
import { DataState, MetaLine, Pager, SourceCoordinate, type Column, DataTable } from './ui';
import { useResource, type Resource } from '../lib/useResource';
import { apiPath, type ViewQuery } from '../lib/query';
import { number, wibTime } from '../lib/format';
export function useSnapshotResource<T extends { meta: DataMeta }>(endpoint: string | null, query: ViewQuery = {}, bindToRoute = true) {
  const { status, dictionaries } = useWorkspace(); const [params, setParams] = useSearchParams();
  const resource = useResource<T>(status.data?.snapshot && endpoint ? apiPath(endpoint, query) : null);
  const displayedId = resource.data?.meta.snapshotId;
  useEffect(() => {
    if (!bindToRoute || !displayedId || query.snapshotId || params.has('snapshotId')) return;
    const next = new URLSearchParams(params); next.set('snapshotId', displayedId); setParams(next, { replace: true });
  }, [bindToRoute, displayedId, query.snapshotId, params, setParams]);
  const loadLatest = () => {
    const next = new URLSearchParams(params); next.delete('snapshotId'); setParams(next, { replace: true });
    resource.reload(); status.reload(); dictionaries.reload();
  };
  const binding = bindToRoute && !!displayedId && !query.snapshotId && !params.has('snapshotId');
  return { ...resource, ...(binding ? { state: 'loading' as const, data: null } : {}), loadLatest };
}
export function SnapshotContent<T>({ resource, children, onLoadLatest }: { resource: Resource<T> & { loadLatest?: () => void }; children: (data: T) => ReactNode; onLoadLatest?: () => void }) {
  const { status } = useWorkspace();
  if (status.state === 'loading') return <DataState state="loading"/>;
  if (status.error) return <DataState state="error" message={status.error} onRetry={status.reload}/>;
  if (!status.data?.snapshot) return <DataState state="setup"/>;
  if (resource.error) return <DataState state="error" message={resource.error} onRetry={resource.errorCode === 'SNAPSHOT_CHANGED' ? onLoadLatest ?? resource.loadLatest : resource.reload} retryLabel={resource.errorCode === 'SNAPSHOT_CHANGED' ? 'Muat data terbaru' : undefined}/>;
  if (!resource.data) return <DataState state="loading"/>;
  return children(resource.data);
}
export function CollectionView<T extends { id: string }>({ data, columns, caption, query, onSort, onPage, onLimit }: { data: Pick<ListResponse<T>, 'rows' | 'pagination'> & { meta?: DataMeta }; columns: Column<T>[]; caption: string; query: ViewQuery; onSort: (key: string) => void; onPage: (page: number) => void; onLimit: (query: ViewQuery) => void }) {
  return <><section className="table-panel" aria-label={caption}><div className="panel-heading"><h2>{caption}<span className="result-count">{number(data.pagination.total)} baris</span></h2><label className="page-size">Baris per halaman<select className="form-select form-select-sm" aria-label="Baris per halaman" value={query.limit ?? '25'} onChange={event => onLimit({ limit: event.target.value })} data-testid="page-size">{['10', '25', '50', '100'].map(limit => <option key={limit} value={limit}>{limit}</option>)}</select></label></div>{data.rows.length ? <DataTable rows={data.rows} columns={columns} caption={caption} sort={query.sort} direction={query.direction} onSort={onSort}/> : <DataState state="empty"/>}<Pager pagination={data.pagination} onPage={onPage}/></section>{data.meta && <MetaLine meta={data.meta}/>}</>;
}
export function IssueDetails({ issues, spreadsheetId, viewContact = false }: { issues: DataIssue[]; spreadsheetId?: string; viewContact?: boolean }) { return <section className="detail-section"><h3>Masalah dan tinjauan data</h3>{issues.length ? <ul className="detail-issues">{issues.map(issue => <li key={issue.id}><div><strong>{issue.code}</strong><span className={`severity severity-${issue.severity}`}>{issue.severity}</span><span className="value-badge">{issue.status}</span></div><p>{issue.message}</p><SourceCoordinate source={issue.source} spreadsheetId={spreadsheetId}/>{viewContact && issue.reviewNote && <p>Catatan tinjauan: {issue.reviewNote} · {wibTime(issue.reviewedAt)}</p>}</li>)}</ul> : <p className="text-secondary">Tidak ada masalah yang tercatat untuk entitas ini.</p>}</section>; }
