export type Role = 'admin' | 'recruiter' | 'leader';
export type SourceMode = 'google-sheets' | 'fixture';
export interface Permissions { viewContact: boolean; manageData: boolean; exportDetail: boolean }
export interface Viewer { id: string; email: string; role: Role }
export interface MeResponse { user: Viewer; permissions: Permissions }
export interface PublicConfig { appName: string; authConfigured: boolean; supabaseUrl: string | null; supabasePublishableKey: string | null; googleOAuthEnabled: boolean }
export interface ApiFailure { error: { code: string; message: string; details?: Record<string, unknown> } }
export interface RawCell { value: string | number | boolean | null; formatted?: string; formula?: string; numberFormat?: string }
export interface RawRow { rowNumber: number; cells: RawCell[] }
export interface RawSheet { name: string; rows: RawRow[] }
export interface RawWorkbook { source: SourceMode; spreadsheetId: string; fetchedAt: string; sheets: RawSheet[]; fingerprint?: string; locale?: string }
export interface SourceRef { sheet: string; row: number; cell?: string }
export interface DateValue { raw: string; iso: string | null; precision: 'day' | 'month' | 'range' | 'unknown' | 'empty'; display: string }
export interface Candidate { id: string; name: string; gender: string; graduationYear: number | null; category: string | null; school: string; region: string; phone?: string; photo?: string; notes?: string; source: SourceRef; issueCodes: string[] }
export interface Application { id: string; candidateId: string; candidateName: string; identityVerified: boolean; candidateGraduationYear: number | null; candidateCategory: string | null; agent: string; agentId: string | null; company: string; companyId: string | null; country: string; workBase: string; position: string; appliedAt: DateValue; agentInterviewAt: DateValue; userInterviewAt: DateValue; joinAt: DateValue; agentInterviewResult: string; userInterviewResult: string; finalResult: string; status: string; stage: string; notes?: string; source: SourceRef; issueCodes: string[] }
export interface Partner { id: string; name: string; kind: 'agent' | 'company'; country: string; agent?: string; contact?: string; address?: string; details?: string; industry?: string; startedYear?: string; status: string; applicationCount: number; passedCount: number; unknownResultCount: number; source: SourceRef; issueCodes: string[] }
export interface Departure { id: string; name: string; position: string; agent: string; company: string; date: DateValue; workBase: string; graduationYear: number | null; status: 'waiting' | 'month-only' | 'recorded' | 'unknown'; confirmed: false; source: SourceRef; issueCodes: string[] }
export interface DataIssue { id: string; code: string; severity: 'critical' | 'warning' | 'info'; message: string; entityType: string; entityId: string; source: SourceRef; field?: string; status: 'open' | 'reviewed' | 'resolved'; reviewNote?: string; reviewedAt?: string; reviewedBy?: string }
export interface MappingDecision { id: string; kind: 'agent' | 'company'; alias: string; targetId: string; reason: string; createdAt: string; createdBy: string }
export interface SnapshotCounts { candidates: number; applications: number; agents: number; companyRows: number; companyUniqueIds: number; companyMissingNames: number; crewRows: number | null; funnelRows: number | null }
export interface Snapshot { id: string; normalizationRevision: string; source: SourceMode; spreadsheetId: string; createdAt: string; fingerprint: string; counts: SnapshotCounts; candidates: Candidate[]; applications: Application[]; agents: Partner[]; companies: Partner[]; departures: Departure[]; issues: DataIssue[]; referenceStats: { funnelRows: number | null; crewRows: number | null; approvedReferenceTabs: string[] } }
/** Read precondition, not a business filter. Omission explicitly requests latest. */
export interface SnapshotReadContext { snapshotId?: string }
export interface QueryFilters { /** AND-combined KPI keys: passed,inProgress,emptyStatus. */ metric?: string; q?: string; from?: string; to?: string; agent?: string; company?: string; country?: string; workBase?: string; position?: string; status?: string; finalResult?: string; stage?: string; year?: string; category?: string; issue?: string; severity?: string; code?: string; reviewStatus?: string }
export interface Pagination { page: number; limit: number; total: number; totalPages: number }
export interface DataMeta { snapshotId: string; source: SourceMode; createdAt: string; filters: QueryFilters; excludedDatePrecision: number }
export interface ListResponse<T> { rows: T[]; pagination: Pagination; meta: DataMeta }
export interface Metric { key: string; label: string; value: number | null; unit: string; scope: 'all-time' | 'apply-cohort' | 'reference'; definition: string; filter?: QueryFilters }
export interface ChartItem { label: string; value: number }
export interface OverviewResponse { meta: DataMeta; metrics: Metric[]; charts: { monthlyApplications: ChartItem[]; statuses: ChartItem[]; results: ChartItem[]; workBases: ChartItem[]; topAgents: ChartItem[] }; quality: { issueCount: number; criticalCount: number; affectedApplications: number } }
export interface FilterOptions { agents: string[]; companies: string[]; countries: string[]; workBases: string[]; positions: string[]; graduationYears: string[]; candidateCategories: string[]; statuses: string[]; finalResults: string[]; stages: string[]; issueCodes: string[] }
export interface SyncState { state: 'never' | 'ok' | 'failed' | 'running'; lastAttemptAt: string | null; lastSuccessAt: string | null; nextRunAt: string | null; message: string | null }
export interface AppStatus { sourceMode: 'google-sheets'; authConfigured: boolean; sheetsConfigured: boolean; spreadsheetId: string; requiredTabs: string[]; referenceTabs: string[]; sync: SyncState; snapshot: { id: string; source: SourceMode; createdAt: string; counts: SnapshotCounts; issueCount: number } | null }
export interface AppSettings { sourceMode: 'google-sheets'; spreadsheetId: string; requiredTabs: string[]; referenceTabs: string[]; syncIntervalMinutes: number; retentionDays: number; authConfigured: boolean; sheetsConfigured: boolean; credentialConfigured: boolean; googleOAuthEnabled: boolean; syncMode?: 'manual' | 'vercel-cron' }
export interface AuditEvent { id: string; at: string; actorId: string; action: string; result: 'ok' | 'failed'; details: Record<string, string | number | boolean | null> }
/** Administrative history is independent of recruitment snapshot availability. */
export interface AuditMeta { kind: 'audit'; generatedAt: string; filters: Pick<QueryFilters, 'q'>; sourceSnapshot: Pick<DataMeta, 'snapshotId' | 'source' | 'createdAt'> | null }
export interface AuditListResponse { rows: AuditEvent[]; pagination: Pagination; meta: AuditMeta }
export interface ApplicationDetail { row: Application; candidate: Candidate | null; issues: DataIssue[]; meta: DataMeta }
export interface CandidateDetail { row: Candidate; applications: Application[]; issues: DataIssue[]; meta: DataMeta }
