import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { DataIssue, ListResponse } from '../../shared/contracts';
import { useAuth } from '../auth/AuthProvider';
import { CollectionView, SnapshotContent, useSnapshotResource } from '../components/Collection';
import { FilterForm, useQueryControls } from '../components/Filters';
import { useWorkspace } from '../components/Shell';
import { DefinitionList, Modal, PageHeader, SourceCoordinate, type Column } from '../components/ui';
import { apiPath } from '../lib/query';
import { ApiError } from '../lib/api';
import { number, wibTime } from '../lib/format';
const severityLabels = { critical: 'Kritis', warning: 'Perhatian', info: 'Informasi' };
const reviewLabels = { open: 'Terbuka', reviewed: 'Ditinjau', resolved: 'Selesai ditinjau' };
const entityRoutes = new Map<string, { path: string; kind?: string }>([
  ['application', { path: '/rekrutmen' }], ['candidate', { path: '/kandidat' }],
  ['company', { path: '/mitra', kind: 'companies' }], ['agent', { path: '/mitra', kind: 'agents' }]
]);
function ReviewModal({ issue, snapshotId, onClose, onReviewed, onLoadLatest }: { issue: DataIssue; snapshotId: string; onClose: () => void; onReviewed: (row: DataIssue) => void; onLoadLatest: () => void }) {
  const { api, session } = useAuth(); const { status } = useWorkspace(); const canManage = !!session.me?.permissions.manageData;
  const [reviewStatus, setReviewStatus] = useState<DataIssue['status']>(issue.status); const [note, setNote] = useState(issue.reviewNote ?? ''); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null); const [saved, setSaved] = useState(false); const [stale, setStale] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); if (!canManage || !note.trim() || busy || stale) return; setBusy(true); setError(null); setSaved(false);
    try {
      const body = { status: reviewStatus, note: note.trim(), snapshotId };
      await api.send(`/api/issues/${encodeURIComponent(issue.id)}/review`, 'POST', body);
      let verified: DataIssue | undefined; let page = 1; let totalPages = 1;
      do { const result = await api.get<ListResponse<DataIssue>>(apiPath('/api/issues', { q: issue.entityId, code: issue.code, limit: '100', page: String(page), snapshotId }));
        if (result.meta.snapshotId !== snapshotId) throw new Error('Snapshot berubah. Muat ulang dan periksa kembali hasil tinjauan.');
        verified = result.rows.find(row => row.id === issue.id && row.status === body.status && row.reviewNote === body.note); totalPages = result.pagination.totalPages; page++;
      } while (!verified && page <= totalPages);
      if (!verified) throw new Error('Tinjauan terkirim, tetapi hasil belum dapat diverifikasi. Muat ulang data sebelum mengulang.');
      setSaved(true); onReviewed(verified);
    } catch (reason) { setStale(reason instanceof ApiError && reason.status === 409 && ['STALE_SNAPSHOT', 'SNAPSHOT_CHANGED'].includes(reason.code)); setError(reason instanceof Error ? reason.message : 'Tinjauan tidak dapat disimpan.'); } finally { setBusy(false); }
  }
  const entityRoute = entityRoutes.get(issue.entityType);
  return <Modal title="Tinjauan masalah data" onClose={onClose}><DefinitionList values={[
    ['Kode / dampak', <><code>{issue.code}</code> · {severityLabels[issue.severity]}</>], ['Entitas', <><code>{issue.entityId}</code><small className="cell-subline">{issue.entityType}</small></>], ['Temuan', issue.message], ['Kolom', issue.field ?? '—'], ['Status tinjauan', reviewLabels[issue.status]], ['Sumber', <SourceCoordinate source={issue.source} spreadsheetId={status.data?.spreadsheetId}/>], ['Snapshot', <code>{snapshotId}</code>]
  ]}/><div className="detail-actions">{entityRoute && <Link className="btn btn-outline-primary" to={apiPath(entityRoute.path, { q: issue.entityId, kind: entityRoute.kind, snapshotId })}>Lihat entitas terdampak</Link>}{canManage && <Link className="btn btn-outline-primary" to="/pengaturan#mapping">Buka mapping eksplisit</Link>}</div><div className="evidence-note">Tinjauan dicatat terpisah dari sumber. Menandai selesai tidak memperbaiki nilai spreadsheet atau membuktikan identitas.</div>{session.me?.permissions.viewContact && issue.reviewNote && <p>Catatan sebelumnya: {issue.reviewNote} · {wibTime(issue.reviewedAt)}</p>}{canManage && <form onSubmit={submit} aria-label="Simpan tinjauan"><div className="mb-3"><label className="form-label" htmlFor="review-status">Hasil tinjauan</label><select className="form-select" id="review-status" data-testid="review-status" value={reviewStatus} onChange={e => setReviewStatus(e.target.value as DataIssue['status'])} disabled={busy || stale}>{Object.entries(reviewLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></div><div className="mb-3"><label htmlFor="review-note" className="form-label">Catatan dan dasar keputusan</label><textarea className="form-control" id="review-note" data-testid="review-note" required maxLength={1000} rows={3} value={note} onChange={e => setNote(e.target.value)} disabled={busy || stale}/></div><button className="btn btn-primary" type="submit" data-testid="review-save" disabled={busy || stale || !note.trim()}>{busy ? 'Menyimpan dan memeriksa…' : 'Simpan tinjauan'}</button></form>}{saved && <p className="alert alert-success mt-3" role="status" data-testid="review-success">Tinjauan tersimpan dan telah diverifikasi dari API.</p>}{error && <div className="alert alert-danger mt-3" role="alert">{error}{stale && <><p>Tutup tinjauan lama dan buka kembali temuan dari data terbaru. Tinjauan tidak dikirim ulang otomatis.</p><button type="button" className="btn btn-outline-primary" onClick={onLoadLatest}>Muat data terbaru</button></>}</div>}</Modal>;
}
export function QualityPage() {
  const controls = useQueryControls(); const { status, dictionaries } = useWorkspace(); const { session } = useAuth(); const resource = useSnapshotResource<ListResponse<DataIssue>>('/api/issues', controls.query); const [selected, setSelected] = useState<{ issue: DataIssue; snapshotId: string } | null>(null);
  const columns: Column<DataIssue>[] = [
    { key: 'severity', label: 'Dampak', sortable: true, render: row => <span className={`severity severity-${row.severity}`}>{severityLabels[row.severity]}</span> },
    { key: 'code', label: 'Masalah', sortable: true, render: row => <><strong>{row.code}</strong><small className="cell-subline issue-message">{row.message}</small></> },
    { key: 'entityType', label: 'Entitas', sortable: true, render: row => <>{row.entityType}<small className="cell-subline"><code>{row.entityId}</code></small></> },
    { key: 'status', label: 'Tinjauan', sortable: true, render: row => reviewLabels[row.status] },
    { key: 'sourceRow', label: 'Sumber', sortable: true, render: row => <SourceCoordinate source={row.source} spreadsheetId={status.data?.spreadsheetId}/> },
    { key: 'actions', label: 'Tindakan', render: row => <button className="btn btn-sm btn-outline-primary" type="button" data-testid="issue-review" onClick={() => setSelected({ issue: row, snapshotId: resource.data!.meta.snapshotId })}>{session.me?.permissions.manageData ? 'Tinjau' : 'Lihat temuan'}</button> }
  ];
  return <><PageHeader title="Kualitas data" description="Temuan sumber tetap dapat ditelusuri. Identitas, ID berulang, status kosong, tanggal, dan rekap tidak diperbaiki otomatis." actions={session.me?.permissions.manageData && <Link className="btn btn-outline-primary" to="/pengaturan#mapping">Mapping eksplisit</Link>}/><FilterForm mode="issues" query={controls.query} options={dictionaries.data} onApply={controls.apply} onReset={controls.reset}/><SnapshotContent resource={resource}>{data => <>{data.rows.length > 0 && <section className="quality-summary" aria-label="Ringkasan halaman ini"><h2>Jenis masalah pada halaman ini</h2><p>{number(data.rows.length)} baris ditampilkan dari {number(data.pagination.total)} hasil filter; bukan total tiap jenis di seluruh sumber.</p><div>{Object.entries(data.rows.reduce<Record<string, number>>((counts, row) => { counts[row.code] = (counts[row.code] ?? 0) + 1; return counts; }, {})).map(([code, count]) => <button key={code} className="btn btn-outline-secondary btn-sm" onClick={() => controls.apply({ code })}>{code} · {number(count)}</button>)}</div></section>}<CollectionView data={data} columns={columns} caption="Temuan kualitas data" query={controls.query} onSort={controls.sort} onPage={controls.page} onLimit={controls.apply}/></>}</SnapshotContent>{selected && <ReviewModal key={selected.issue.id} {...selected} onClose={() => setSelected(null)} onLoadLatest={() => { setSelected(null); resource.loadLatest(); }} onReviewed={row => { setSelected(current => current ? { ...current, issue: row } : null); resource.reload(); }}/>}</>;
}
