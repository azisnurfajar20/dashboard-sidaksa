// Synthetic boundary adapted from the independent FE-01..FE-05 audit.
// Executes the real app/provider; no listeners, credentials or live services.
import { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AppRoutes } from '../../web/App';
import { AuthProvider, ProtectedApp, useAuth } from '../../web/auth/AuthProvider';
import { applicationsFor, candidatesFor, partnersFor, dictionaries } from '../../server/domain/query';
import { filterKeys } from '../../web/lib/query';
import { application as baseApplication, candidate, partner, issue as baseIssue, status as baseStatus, meta as baseMeta } from './fixture';
const testWindow = window as any;
const mode = testWindow.__frontendMode ?? 'normal';
const company = { ...partner, id: 'CO_SYNTHETIC', name: 'Synthetic Company', kind: 'company', issueCodes: ['DUPLICATE_ID'] };
const application = { ...baseApplication, agentId: partner.id, agent: partner.name, companyId: company.id, company: company.name };
let issue = { ...baseIssue, id: 'ISSUE_SYNTHETIC', code: 'DUPLICATE_ID', entityType: testWindow.__entityType ?? 'company', entityId: company.id };
if (issue.entityType === 'agent') issue.entityId = partner.id;
if (issue.entityType === 'candidate') issue.entityId = candidate.id;
if (issue.entityType === 'application') issue.entityId = application.id;
let snapshot: any = { id: 'synthetic-A', source: 'fixture', spreadsheetId: 'SYNTHETIC_ONLY', createdAt: baseMeta.createdAt, fingerprint: 'SYNTHETIC_ONLY', counts: baseStatus.snapshot!.counts, candidates: [candidate], applications: [application], agents: [partner], companies: [company], departures: [], issues: [issue], referenceStats: { funnelRows: null, crewRows: null, approvedReferenceTabs: [] } };
const requests: any[] = [];
let verificationMode = 'same'; let releaseVerification: (() => void) | undefined; let verificationGate: Promise<void> | undefined;
const admin = { user: { id: 'synthetic-user', email: 'synthetic@example.invalid', role: 'admin' }, permissions: { viewContact: true, manageData: true, exportDetail: true } };
function response(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } }); }
function failure(status: number, code: string) { return response({ error: { code, message: 'UNTRUSTED_SYNTHETIC_ERROR_BODY' } }, status); }
function meta(filters = {}) { return { ...baseMeta, snapshotId: snapshot.id, filters }; }
function list(rows: any[], query: any) { return { rows, pagination: { page: query.page, limit: query.limit, total: rows.length, totalPages: Math.max(1, Math.ceil(rows.length / query.limit)) }, meta: meta(query.filters) }; }
function parsed(url: URL) { return { filters: Object.fromEntries([...url.searchParams].filter(([key]) => filterKeys.includes(key as any))), page: Number(url.searchParams.get('page') || 1), limit: Number(url.searchParams.get('limit') || 25) }; }
const controls = testWindow.__frontend = {
  requests, mounts: 0, unmounts: 0, probeResult: '',
  publish() { snapshot = { ...snapshot, id: 'synthetic-B' }; },
  emit(event: string, token: string | null) { testWindow.__emitSyntheticAuth(event, token); },
  holdVerification(nextMode = 'same') { verificationMode = nextMode; verificationGate = new Promise<void>(resolve => { releaseVerification = resolve; }); },
  releaseVerification() { releaseVerification?.(); verificationGate = undefined; },
  async probe() { try { await testWindow.__privateApi.send('/api/probe-privileged', 'POST', {}); controls.probeResult = 'sent'; } catch { controls.probeResult = 'blocked'; } }
};
globalThis.fetch = async (input: any, init: RequestInit = {}) => {
  const url = new URL(String(input), location.origin); const method = init.method || 'GET';
  const record = { path: url.pathname + url.search, method, body: init.body ? JSON.parse(String(init.body)) : null, completed: false, rejected: false, refreshedBearer: new Headers(init.headers).get('Authorization') === 'Bearer SYNTHETIC_ACCESS_B' }; requests.push(record);
  if (url.pathname === '/api/public-config') return response({ appName: 'SIDAKSA', authConfigured: true, supabaseUrl: 'https://synthetic-auth.invalid', supabasePublishableKey: 'SYNTHETIC_PUBLIC_MARKER', googleOAuthEnabled: false });
  if (url.pathname === '/api/me') {
    const nextMode = verificationMode; await verificationGate; record.completed = true;
    if (nextMode === 'revoked') return failure(401, 'UNAUTHORIZED');
    if (nextMode === 'denied') return failure(403, 'FORBIDDEN');
    if (nextMode === 'invalid') return response({ user: admin.user, permissions: { ...admin.permissions, manageData: 'yes' } });
    if (nextMode === 'invalid-identity') return response({ ...admin, user: { ...admin.user, id: 123, email: null } });
    if (nextMode === 'identity') return response({ ...admin, user: { ...admin.user, id: 'synthetic-other-user' } });
    if (nextMode === 'role') return response({ ...admin, user: { ...admin.user, role: 'recruiter' } });
    if (nextMode === 'permission') return response({ ...admin, permissions: { ...admin.permissions, viewContact: false, manageData: false } });
    return response(admin);
  }
  if (url.pathname === '/api/status') return response({ ...baseStatus, referenceTabs: [], snapshot: { ...baseStatus.snapshot, id: snapshot.id } });
  if (url.pathname === '/api/dictionaries') return response(dictionaries(snapshot));
  if (url.pathname === '/api/probe-privileged') return response({ synthetic: true });
  const query = parsed(url);
  if (method === 'POST' && url.pathname.endsWith('/review')) {
    if (record.body.snapshotId !== snapshot.id) { record.rejected = true; return failure(409, 'STALE_SNAPSHOT'); }
    issue = { ...issue, status: record.body.status, reviewNote: record.body.note }; snapshot.issues = [issue]; return response({ row: issue, snapshotId: snapshot.id });
  }
  if (url.searchParams.has('snapshotId') && url.searchParams.get('snapshotId') !== snapshot.id) return failure(409, 'SNAPSHOT_CHANGED');
  if (url.pathname === '/api/applications') return response(list(applicationsFor(snapshot, query.filters).rows, query));
  if (url.pathname === '/api/candidates') return response(list(candidatesFor(snapshot, query.filters), query));
  if (url.pathname.startsWith('/api/candidates/')) {
    if (mode === 'ambiguous') return failure(409, 'AMBIGUOUS_ID');
    return response({ row: candidate, applications: [application], issues: [], meta: meta() });
  }
  if (url.pathname === '/api/partners') return response(list(partnersFor(snapshot, (url.searchParams.get('kind') || 'agents') as any, query.filters).rows, query));
  if (url.pathname === '/api/issues') return response(list(snapshot.issues.filter((row: any) => (!query.filters.q || row.entityId.toLowerCase().includes(query.filters.q.toLowerCase())) && (!query.filters.code || row.code === query.filters.code) && (!query.filters.severity || row.severity === query.filters.severity) && (!query.filters.reviewStatus || row.status === query.filters.reviewStatus)), query));
  return failure(404, 'SYNTHETIC_NOT_IMPLEMENTED');
};
function InteractionProbe() {
  const auth = useAuth(); testWindow.__privateApi = auth.api;
  useEffect(() => { controls.mounts++; return () => { controls.unmounts++; }; }, []);
  return <button data-testid="privileged-probe" onClick={() => void controls.probe()}>Synthetic privileged probe</button>;
}
createRoot(document.getElementById('root')!).render(<BrowserRouter><AuthProvider><ProtectedApp><InteractionProbe/><AppRoutes/></ProtectedApp></AuthProvider></BrowserRouter>);
