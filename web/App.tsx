import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';
import type { OverviewResponse } from '../shared/contracts';
import { AuthProvider, ProtectedApp, useAuth } from './auth/AuthProvider';
import { Shell, useWorkspace } from './components/Shell';
import { FilterForm, useQueryControls } from './components/Filters';
import { ExportButton } from './components/ExportButton';
import { PageHeader } from './components/ui';
import { SnapshotContent, useSnapshotResource } from './components/Collection';
import { OverviewView } from './pages/Overview';
import { ApplicationsPage } from './pages/Applications';
import { CandidatesPage } from './pages/Candidates';
import { PartnersPage } from './pages/Partners';
import { DeparturesPage } from './pages/Departures';
import { QualityPage } from './pages/Quality';
import { SettingsPage } from './pages/Settings';
import { PasswordChangePage } from './pages/PasswordChange';
function OverviewPage() {
  const controls = useQueryControls(); const { status, dictionaries } = useWorkspace();
  const resource = useSnapshotResource<OverviewResponse>('/api/overview', controls.query);
  return <><PageHeader title="Overview" eyebrow="MONITORING AKSES KERJA" description="Master kandidat, cohort lamaran, dan kualitas data pada snapshot yang sama." actions={<ExportButton kind="aggregate" filters={controls.query} snapshotId={resource.data?.meta.snapshotId} onLoadLatest={resource.loadLatest} available={!!resource.data}/>}/><FilterForm mode="overview" query={controls.query} options={dictionaries.data} onApply={controls.apply} onReset={controls.reset}/><SnapshotContent resource={resource}>{data => <OverviewView data={data}/>}</SnapshotContent></>;
}
export function AdminOnly({ children }: { children: React.ReactNode }) { const { session } = useAuth(); return session.me?.permissions.manageData ? children : <><PageHeader title="Akses admin diperlukan" description="Pengaturan dan perubahan tinjauan hanya tersedia untuk admin data yang disetujui."/><Link to="/" className="btn btn-outline-primary">Kembali ke Overview</Link></>; }
export function AppRoutes() {
  return <Routes><Route element={<Shell/>}><Route index element={<OverviewPage/>}/><Route path="rekrutmen" element={<ApplicationsPage/>}/><Route path="kandidat" element={<CandidatesPage/>}/><Route path="mitra" element={<PartnersPage/>}/><Route path="keberangkatan" element={<DeparturesPage/>}/><Route path="kualitas-data" element={<QualityPage/>}/><Route path="pengaturan" element={<AdminOnly><SettingsPage/></AdminOnly>}/>
<Route path="password" element={<PasswordChangePage/>}/><Route path="*" element={<><PageHeader title="Halaman tidak ditemukan" description="Alamat ini tidak tersedia di ruang kerja SIDAKSA."/><Link to="/" className="btn btn-primary">Kembali ke Overview</Link></>}/></Route></Routes>;
}
export function App() { return <BrowserRouter><AuthProvider><ProtectedApp><AppRoutes/></ProtectedApp></AuthProvider></BrowserRouter>; }
