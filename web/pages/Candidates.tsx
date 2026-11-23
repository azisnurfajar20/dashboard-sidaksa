import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { Candidate, CandidateDetail, ListResponse } from '../../shared/contracts';
import { useAuth } from '../auth/AuthProvider';
import { CollectionView, IssueDetails, SnapshotContent, useSnapshotResource } from '../components/Collection';
import { ExportButton } from '../components/ExportButton';
import { FilterForm, useQueryControls } from '../components/Filters';
import { useWorkspace } from '../components/Shell';
import { DataTable, DateCell, DefinitionList, EvidenceNotice, IssueFlag, MetaLine, Modal, PageHeader, SourceCoordinate, ValueBadge, type Column } from '../components/ui';
import { filled, number } from '../lib/format';
import { apiPath } from '../lib/query';
export function CandidateEvidence({ data, viewContact = false, spreadsheetId }: { data: CandidateDetail; viewContact?: boolean; spreadsheetId?: string }) {
  const candidate = data.row; const photo = candidate.photo && /^https:\/\//i.test(candidate.photo) ? candidate.photo : null;
  return <><DefinitionList values={[
    ['ID kandidat', <code>{candidate.id}</code>], ['Nama master', candidate.name], ['Jenis kelamin', filled(candidate.gender)], ['Tahun lulus tervalidasi', candidate.graduationYear == null ? 'Belum diisi' : String(candidate.graduationYear)], ['Kategori peserta', filled(candidate.category)], ['Sekolah', filled(candidate.school)], ['Daerah', filled(candidate.region)], ['Sumber master', <SourceCoordinate source={candidate.source} spreadsheetId={spreadsheetId}/>]
  ]}/>{viewContact ? <section className="detail-section"><h3>Kontak dan catatan berizin</h3><DefinitionList values={[["Telepon", filled(candidate.phone)], ['Catatan kandidat', filled(candidate.notes)], ['Foto sumber', photo ? <a href={photo} target="_blank" rel="noopener noreferrer">Buka foto di sumber (izin sumber berlaku)</a> : 'Belum diisi']]}/><p className="text-secondary small">Foto tidak dimuat otomatis. Tautan sumber tetap mengikuti izin pemilik.</p></section> : <p className="permission-notice">Kontak, foto, dan catatan pribadi tidak tersedia untuk izin akun ini.</p>}<section className="detail-section"><h3>{number(data.applications.length)} lamaran terkait</h3><p className="text-secondary">Seluruh lamaran yang terkait dengan ID ini pada snapshot; bukan hanya cohort filter direktori. Masalah identitas tetap ditampilkan.</p><EvidenceNotice/>{data.applications.length ? <DataTable rows={data.applications} caption="Seluruh lamaran kandidat" columns={[
    { key: 'id', label: 'Lamaran / posisi', render: row => <><Link className="table-detail" to={apiPath('/rekrutmen', { q: row.id, snapshotId: data.meta.snapshotId })}>{filled(row.position)}</Link><small className="cell-subline">{row.id}</small>{!row.identityVerified && <span className="issue-flag">Identitas belum tervalidasi</span>}</> },
    { key: 'appliedAt', label: 'Tanggal apply', render: row => <DateCell date={row.appliedAt}/> },
    { key: 'agent', label: 'Agen / company', render: row => <>{filled(row.agent)}<small className="cell-subline">{filled(row.company)}</small></> },
    { key: 'status', label: 'Status / hasil akhir', render: row => <><ValueBadge value={row.status}/><small className="cell-subline">{filled(row.finalResult)}</small></> },
    { key: 'source', label: 'Sumber', render: row => <SourceCoordinate source={row.source} spreadsheetId={spreadsheetId}/> }
  ]}/> : <p className="text-secondary">Belum ada lamaran terkait pada snapshot ini.</p>}</section><IssueDetails issues={data.issues} viewContact={viewContact} spreadsheetId={spreadsheetId}/><MetaLine meta={data.meta}/></>;
}
function CandidateModal({ id, snapshotId, onClose, onLoadLatest }: { id: string; snapshotId: string; onClose: () => void; onLoadLatest: () => void }) { const resource = useSnapshotResource<CandidateDetail>(`/api/candidates/${encodeURIComponent(id)}`, { snapshotId }, false); const { session } = useAuth(); const { status } = useWorkspace(); return <Modal title="Profil kandidat" onClose={onClose}><SnapshotContent resource={resource} onLoadLatest={onLoadLatest}>{data => <CandidateEvidence data={data} viewContact={!!session.me?.permissions.viewContact} spreadsheetId={status.data?.spreadsheetId}/>}</SnapshotContent></Modal>; }
export function CandidatesPage() {
  const controls = useQueryControls(); const { status, dictionaries } = useWorkspace(); const [selected, setSelected] = useState<{ id: string; snapshotId: string } | null>(null); const resource = useSnapshotResource<ListResponse<Candidate>>('/api/candidates', controls.query);
  const columns: Column<Candidate>[] = [
    { key: 'name', label: 'Kandidat / ID', sortable: true, render: row => <><button className="table-detail" type="button" onClick={() => setSelected({ id: row.id, snapshotId: resource.data!.meta.snapshotId })} data-testid="candidate-detail">{filled(row.name)}</button><small className="cell-subline">{row.id}</small></> },
    { key: 'graduationYear', label: 'Tahun lulus', sortable: true, render: row => row.graduationYear == null ? 'Belum diisi / kategori' : String(row.graduationYear) },
    { key: 'category', label: 'Kategori peserta', sortable: true, render: row => filled(row.category) },
    { key: 'school', label: 'Sekolah', sortable: true, render: row => filled(row.school) },
    { key: 'region', label: 'Daerah', sortable: true, render: row => filled(row.region) },
    { key: 'source', label: 'Sumber / kualitas', render: row => <><SourceCoordinate source={row.source} spreadsheetId={status.data?.spreadsheetId}/><IssueFlag codes={row.issueCodes}/></> }
  ];
  return <><PageHeader title="Kandidat" description="Direktori seluruh master. Tahun lulus yang valid terpisah dari kategori peserta; bukan jumlah seluruh alumni." actions={<ExportButton kind="candidates" filters={controls.query} snapshotId={resource.data?.meta.snapshotId} onLoadLatest={resource.loadLatest} available={!!resource.data}/>}/><FilterForm mode="candidates" query={controls.query} options={dictionaries.data} onApply={controls.apply} onReset={controls.reset}/><SnapshotContent resource={resource}>{data => <CollectionView data={data} columns={columns} caption="Direktori kandidat" query={controls.query} onSort={controls.sort} onPage={controls.page} onLimit={controls.apply}/>}</SnapshotContent>{selected && <CandidateModal key={`${selected.id}:${selected.snapshotId}`} {...selected} onClose={() => setSelected(null)} onLoadLatest={() => { setSelected(null); resource.loadLatest(); }}/>}</>;
}
