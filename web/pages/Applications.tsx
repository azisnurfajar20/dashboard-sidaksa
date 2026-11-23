import { useState } from 'react';
import type { Application, ApplicationDetail, ListResponse } from '../../shared/contracts';
import { useAuth } from '../auth/AuthProvider';
import { CollectionView, IssueDetails, SnapshotContent, useSnapshotResource } from '../components/Collection';
import { ExportButton } from '../components/ExportButton';
import { FilterForm, useQueryControls } from '../components/Filters';
import { useWorkspace } from '../components/Shell';
import { DataState, DataTable, DateCell, DefinitionList, EvidenceNotice, IssueFlag, MetaLine, Modal, PageHeader, SourceCoordinate, ValueBadge, type Column } from '../components/ui';
import { filled, number } from '../lib/format';
export function applicationColumns(onSelect: (id: string) => void, spreadsheetId?: string): Column<Application>[] { return [
  { key: 'candidateName', label: 'Kandidat / ID', sortable: true, render: row => <><button className="table-detail" type="button" onClick={() => onSelect(row.id)} data-testid="application-detail">{filled(row.candidateName)}</button><small className="cell-subline">{row.candidateId}</small>{!row.identityVerified && <span className="issue-flag">Identitas belum tervalidasi</span>}</> },
  { key: 'appliedAt', label: 'Tanggal apply', sortable: true, render: row => <DateCell date={row.appliedAt}/> },
  { key: 'agent', label: 'Agen / company', sortable: true, render: row => <>{filled(row.agent)}<small className="cell-subline">{filled(row.company)}</small>{(!row.agentId || !row.companyId) && <small className="text-warning-emphasis">Relasi belum terpetakan</small>}</> },
  { key: 'position', label: 'Posisi / basis', sortable: true, render: row => <>{filled(row.position)}<small className="cell-subline">{filled(row.workBase)} · {filled(row.country)}</small></> },
  { key: 'status', label: 'Status proses', sortable: true, render: row => <ValueBadge value={row.status}/> },
  { key: 'finalResult', label: 'Hasil akhir', sortable: true, render: row => <ValueBadge value={row.finalResult}/> },
  { key: 'stage', label: 'Tahap terbukti', sortable: true, render: row => filled(row.stage) },
  { key: 'source', label: 'Sumber / kualitas', render: row => <><SourceCoordinate source={row.source} spreadsheetId={spreadsheetId}/><IssueFlag codes={row.issueCodes}/></> }
]; }
export function ApplicationEvidence({ data, viewContact = false, spreadsheetId }: { data: ApplicationDetail; viewContact?: boolean; spreadsheetId?: string }) {
  const row = data.row;
  return <><div className="semantic-notice">Completed tidak berarti berangkat. Lolos seleksi akhir bukan bukti sudah bekerja atau keberangkatan terkonfirmasi.</div><DefinitionList values={[
    ['ID lamaran dalam snapshot', <code>{row.id}</code>], ['Kandidat', <>{row.candidateName}<small className="cell-subline">{row.candidateId} · {row.identityVerified ? 'Identitas tervalidasi' : 'Identitas belum tervalidasi'}</small></>], ['Agen / ID terpetakan', <>{filled(row.agent)}<small className="cell-subline">{filled(row.agentId)}</small></>], ['Company / ID terpetakan', <>{filled(row.company)}<small className="cell-subline">{filled(row.companyId)}</small></>], ['Posisi', filled(row.position)], ['Negara / basis kerja', `${filled(row.country)} / ${filled(row.workBase)}`], ['Status proses', <ValueBadge value={row.status}/>], ['Hasil akhir', <ValueBadge value={row.finalResult}/>], ['Tahap berdasarkan bukti', filled(row.stage)], ['Sumber', <SourceCoordinate source={row.source} spreadsheetId={spreadsheetId}/>]
  ]}/><section className="detail-section"><h3>Bukti milestone yang tersedia</h3><EvidenceNotice/><div className="table-responsive"><table className="table"><thead><tr><th>Milestone</th><th>Tanggal / presisi</th><th>Hasil tercatat</th></tr></thead><tbody><tr><th scope="row">Apply</th><td><DateCell date={row.appliedAt}/></td><td>—</td></tr><tr><th scope="row">Interview agen</th><td><DateCell date={row.agentInterviewAt}/></td><td>{filled(row.agentInterviewResult)}</td></tr><tr><th scope="row">Interview user</th><td><DateCell date={row.userInterviewAt}/></td><td>{filled(row.userInterviewResult)}</td></tr><tr><th scope="row">Catatan join</th><td><DateCell date={row.joinAt}/></td><td>Belum terkonfirmasi</td></tr></tbody></table></div></section>{viewContact && <section className="detail-section"><h3>Kontak dan catatan berizin</h3><DefinitionList values={[["Telepon kandidat", row.identityVerified && data.candidate?.id === row.candidateId ? filled(data.candidate?.phone) : 'Identitas belum tervalidasi — kontak tidak dipadankan'], ['Catatan lamaran', filled(row.notes)]]}/></section>}<IssueDetails issues={data.issues} viewContact={viewContact} spreadsheetId={spreadsheetId}/><MetaLine meta={data.meta}/></>;
}
export function ApplicationModal({ id, snapshotId, onClose, onLoadLatest }: { id: string; snapshotId: string; onClose: () => void; onLoadLatest: () => void }) {
  const resource = useSnapshotResource<ApplicationDetail>(`/api/applications/${encodeURIComponent(id)}`, { snapshotId }, false); const { status } = useWorkspace(); const { session } = useAuth();
  return <Modal title="Rincian lamaran" onClose={onClose}><SnapshotContent resource={resource} onLoadLatest={onLoadLatest}>{data => <ApplicationEvidence data={data} viewContact={!!session.me?.permissions.viewContact} spreadsheetId={status.data?.spreadsheetId}/>}</SnapshotContent></Modal>;
}
export function ApplicationsPage() {
  const controls = useQueryControls(); const { status, dictionaries } = useWorkspace(); const [selected, setSelected] = useState<{ id: string; snapshotId: string } | null>(null);
  const resource = useSnapshotResource<ListResponse<Application>>('/api/applications', controls.query);
  return <><PageHeader title="Rekrutmen" description="Satu baris per lamaran. Filter periode mengikuti tanggal apply, bukan tanggal keberangkatan." actions={<ExportButton kind="applications" filters={controls.query} snapshotId={resource.data?.meta.snapshotId} onLoadLatest={resource.loadLatest} available={!!resource.data}/>}/><FilterForm mode="applications" query={controls.query} options={dictionaries.data} onApply={controls.apply} onReset={controls.reset}/><EvidenceNotice/><SnapshotContent resource={resource}>{data => <CollectionView data={data} columns={applicationColumns(id => setSelected({ id, snapshotId: data.meta.snapshotId }), status.data?.spreadsheetId)} caption="Daftar lamaran" query={controls.query} onSort={controls.sort} onPage={controls.page} onLimit={controls.apply}/>}</SnapshotContent>{selected && <ApplicationModal key={`${selected.id}:${selected.snapshotId}`} {...selected} onClose={() => setSelected(null)} onLoadLatest={() => { setSelected(null); resource.loadLatest(); }}/>}</>;
}
