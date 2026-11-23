import { Link } from 'react-router-dom';
import type { Departure, ListResponse } from '../../shared/contracts';
import { useAuth } from '../auth/AuthProvider';
import { CollectionView, SnapshotContent, useSnapshotResource } from '../components/Collection';
import { ExportButton } from '../components/ExportButton';
import { FilterForm, useQueryControls } from '../components/Filters';
import { useWorkspace } from '../components/Shell';
import { DataState, DateCell, PageHeader, type Column } from '../components/ui';
import { filled } from '../lib/format';
const categoryLabels: Record<Departure['status'], string> = { waiting: 'Menunggu jadwal', 'month-only': 'Bulan saja', recorded: 'Tanggal harian tercatat', unknown: 'Tidak diketahui' };
export function DeparturesPage() {
  const controls = useQueryControls(); const { status, dictionaries } = useWorkspace(); const { session } = useAuth();
  const available = !!status.data?.referenceTabs.includes('Crew List Departure') && status.data?.snapshot?.counts.crewRows != null;
  const resource = useSnapshotResource<ListResponse<Departure>>(available ? '/api/departures' : null, controls.query);
  const columns: Column<Departure>[] = [
    { key: 'name', label: 'Nama', sortable: true, render: row => <><strong>{filled(row.name)}</strong><small className="cell-subline">Belum dipadankan ke orang unik berdasarkan nama saja</small></> },
    { key: 'position', label: 'Posisi', sortable: true, render: row => <>{filled(row.position)}</> },
    { key: 'agent', label: 'Agent', sortable: true, render: row => <>{filled(row.agent)}</> },
    { key: 'company', label: 'Company', sortable: true, render: row => <>{filled(row.company)}</> },
    { key: 'date', label: 'Tanggal Berangkat', sortable: true, render: row => <DateCell date={row.date}/> },
    { key: 'workBase', label: 'Basis Kerja', sortable: true, render: row => <>{filled(row.workBase)}</> },
    { key: 'graduationYear', label: 'Tahun Lulus', sortable: true, render: row => <>{row.graduationYear ?? '—'}</> },
    { key: 'status', label: 'Kategori catatan', sortable: true, render: row => categoryLabels[row.status] },
    { key: 'verification', label: 'Verifikasi keberangkatan', render: () => <span className="value-badge value-warning">Belum terkonfirmasi</span> }
  ];
  return <><PageHeader title="Catatan keberangkatan" description="Entri roster sumber, bukan jumlah orang unik yang sudah berangkat. Tanggal tercatat tidak otomatis membuktikan keberangkatan aktual." actions={<ExportButton kind="departures" filters={controls.query} snapshotId={resource.data?.meta.snapshotId} onLoadLatest={resource.loadLatest} available={available && !!resource.data}/>}/><div className="semantic-notice">Belum ada definisi bukti keberangkatan terkonfirmasi. Menunggu jadwal, bulan saja, dan tanggal harian dipisahkan; tidak ada status yang otomatis dianggap sudah berangkat.</div>{status.state === 'loading' ? <DataState state="loading"/> : status.error ? <DataState state="error" message={status.error} onRetry={status.reload}/> : !status.data?.snapshot ? <DataState state="setup"/> : !available ? <section className="data-state" role="status" data-testid="departures-unavailable"><h2>Referensi keberangkatan belum tersedia</h2><p>Tab Crew List Departure belum disetujui atau belum ada pada snapshot yang berhasil. Nilai tidak tersedia, bukan nol. Tidak ada data pengganti.</p>{session.me?.permissions.manageData && <Link to="/pengaturan" className="btn btn-outline-primary">Tinjau persetujuan tab referensi</Link>}</section> : <><FilterForm mode="departures" query={controls.query} options={dictionaries.data} onApply={controls.apply} onReset={controls.reset}/><SnapshotContent resource={resource}>{data => <CollectionView data={data} columns={columns} caption="Catatan roster keberangkatan" query={controls.query} onSort={controls.sort} onPage={controls.page} onLimit={controls.apply}/>}</SnapshotContent></>}</>;
}
