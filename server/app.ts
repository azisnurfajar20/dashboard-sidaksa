import express, { type ErrorRequestHandler, type Express, type RequestHandler } from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { lstat } from 'node:fs/promises';
import path from 'node:path';
import type { AuditListResponse, DataIssue, MappingDecision, QueryFilters, Snapshot, SnapshotReadContext, Viewer } from '../shared/contracts.js';
import { ApiError, createSupabaseAuthenticator, permissions, type Authenticator } from './auth.js';
import { publicConfig, type Config } from './config.js';
import { createGoogleSource } from './google.js';
import { assertMappingSource, createStore, type Store } from './store.js';
import { createSyncService, type SyncService } from './sync.js';
import { REQUIRED_TABS, normalizeWorkbook } from './domain/normalize.js';
import { applicationsFor, candidatesFor, csvExport, departuresFor, dictionaries, meta, overview, partnersFor, type ExportKind } from './domain/query.js';

const sensitiveFields = new Set(['phone', 'photo', 'notes', 'contact', 'address', 'details', 'reviewNote']);
function project<T>(value: T, viewer: Viewer): T {
  if (viewer.role !== 'leader') return value;
  if (Array.isArray(value)) return value.map(v => project(v, viewer)) as T;
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => !sensitiveFields.has(key)).map(([key, v]) => [key, project(v, viewer)])) as T;
  return value;
}
const applicationFilters = ['q', 'from', 'to', 'agent', 'company', 'country', 'workBase', 'position', 'status', 'finalResult', 'stage', 'year', 'category', 'issue', 'metric'] as const;
const candidateFilters = ['q', 'year', 'category', 'issue'] as const;
const departureFilters = ['q', 'from', 'to', 'agent', 'company', 'workBase', 'position', 'status', 'year', 'issue'] as const;
const issueFilters = ['q', 'code', 'severity', 'reviewStatus'] as const;
const applicationSorts = ['id', 'candidateId', 'candidateName', 'agent', 'company', 'country', 'workBase', 'position', 'appliedAt', 'finalResult', 'status', 'stage', 'sourceRow'];
const candidateSorts = ['id', 'name', 'gender', 'graduationYear', 'category', 'school', 'region', 'sourceRow'];
const partnerSorts = ['id', 'name', 'country', 'status', 'applicationCount', 'passedCount', 'unknownResultCount', 'sourceRow'];
const departureSorts = ['id', 'name', 'agent', 'company', 'date', 'status', 'position', 'workBase', 'graduationYear', 'sourceRow'];
const issueSorts = ['id', 'code', 'severity', 'status', 'entityType', 'entityId', 'sourceRow'];
interface ParsedQuery extends SnapshotReadContext { filters: QueryFilters; page: number; limit: number; sort?: string; direction: 'asc' | 'desc'; extras: Record<string, string> }
const badQuery = () => new ApiError(400, 'INVALID_QUERY', 'Parameter pencarian, filter, atau pagination tidak valid.');
function parseQuery(input: Record<string, unknown>, allowed: readonly (keyof QueryFilters)[], sorts: readonly string[] = [], extras: readonly string[] = []): ParsedQuery {
  const result: ParsedQuery = { filters: {}, page: 1, limit: 25, direction: 'asc', extras: {} };
  for (const [key, value] of Object.entries(input)) {
    if (typeof value !== 'string' || value.length > 200 || /[\u0000-\u001f\u007f]/.test(value)) throw badQuery();
    if (key === 'snapshotId') {
      if (!value.trim()) throw badQuery();
      result.snapshotId = value;
    } else if (key === 'page' || key === 'limit') {
      if (!/^[1-9]\d{0,4}$/.test(value) || Number(value) > (key === 'limit' ? 100 : 10000)) throw badQuery();
      result[key] = Number(value);
    } else if (key === 'sort') {
      if (!sorts.includes(value)) throw badQuery(); result.sort = value;
    } else if (key === 'direction') {
      if (value !== 'asc' && value !== 'desc') throw badQuery(); result.direction = value;
    } else if (extras.includes(key)) result.extras[key] = value;
    else if (allowed.includes(key as keyof QueryFilters)) result.filters[key as keyof QueryFilters] = value;
    else throw badQuery();
  }
  const f = result.filters;
  for (const date of [f.from, f.to]) if (date !== undefined && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date + 'T00:00:00Z')) || new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) !== date)) throw badQuery();
  if (f.from && f.to && f.from > f.to) throw badQuery();
  if (f.year !== undefined && f.year !== '__empty__' && (!/^\d{4}$/.test(f.year) || Number(f.year) < 1900 || Number(f.year) > 2200)) throw badQuery();
  if (f.severity !== undefined && !['critical', 'warning', 'info'].includes(f.severity)) throw badQuery();
  if (f.reviewStatus !== undefined && !['open', 'reviewed', 'resolved'].includes(f.reviewStatus)) throw badQuery();
  if (f.metric !== undefined) {
    const keys = f.metric.split(',');
    if (!keys.length || keys.length > 3 || new Set(keys).size !== keys.length || keys.some(k => !['passed', 'inProgress', 'emptyStatus'].includes(k))) throw badQuery();
  }
  return result;
}
const noQuery: RequestHandler = (req, _res, next) => { if (Object.keys(req.query).length) throw badQuery(); next(); };
const adminOnly: RequestHandler = (_req, res, next) => { if ((res.locals.viewer as Viewer).role !== 'admin') throw new ApiError(403, 'ADMIN_REQUIRED', 'Operasi ini hanya tersedia untuk admin data.'); next(); };
const settingsBody = z.object({ referenceTabs: z.array(z.enum(['Crew List Departure', 'Funnel Rekap'])).max(2).refine(tabs => new Set(tabs).size === tabs.length), syncIntervalMinutes: z.number().int().min(1).max(1440), retentionDays: z.number().int().min(1).max(365) }).strict();
const identifier = z.string().min(1).max(200).refine(s => s.trim().length > 0 && !/[\u0000-\u001f\u007f]/.test(s));
const mappingBody = z.object({ kind: z.enum(['agent', 'company']), alias: identifier, targetId: identifier, reason: z.string().min(1).max(1000).refine(s => s.trim().length > 0), snapshotId: identifier }).strict();
const reviewBody = z.object({ status: z.enum(['open', 'reviewed', 'resolved']), note: z.string().max(1000), snapshotId: identifier }).strict();
function body<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ApiError(400, 'INVALID_BODY', 'Isi permintaan tidak valid.');
  return parsed.data;
}
function ordered<T>(rows: T[], query: ParsedQuery): T[] {
  if (!query.sort && query.direction === 'asc') return rows;
  const key = query.sort || 'sourceRow';
  const value = (row: T): unknown => {
    const r = row as Record<string, unknown>;
    const v = key === 'sourceRow' ? (r.source as { row?: number } | undefined)?.row : r[key];
    return v && typeof v === 'object' && 'iso' in v ? v.iso : v;
  };
  return [...rows].sort((a, b) => {
    const x = value(a), y = value(b);
    const comparison = x == null ? (y == null ? 0 : 1) : y == null ? -1 : typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'id', { numeric: true });
    return query.direction === 'desc' ? -comparison : comparison;
  });
}
function list<T>(snapshot: Snapshot, rows: T[], query: ParsedQuery = { filters: {}, page: 1, limit: 25, direction: 'asc', extras: {} }, excluded = 0) {
  return { rows: ordered(rows, query).slice((query.page - 1) * query.limit, query.page * query.limit), pagination: { page: query.page, limit: query.limit, total: rows.length, totalPages: Math.ceil(rows.length / query.limit) }, meta: meta(snapshot, query.filters, excluded) };
}

export interface AppOptions {
  config: Config;
  store?: Store;
  authenticator?: Authenticator;
  sync?: SyncService;
  /** Only a trusted isolated test may explicitly enable fixture responses. */
  allowFixtureForTests?: boolean;
  development?: boolean;
  now?: () => Date;
}
export interface AppServices { config: Config; store: Store; sync: SyncService; runtimeId?: string }
export type SidaksaApp = Express & { locals: Express['locals'] & { sidaksa: AppServices } };

export async function assertPrivateStoreLocation(directory: string, projectRoot: string): Promise<void> {
  const target = path.resolve(directory);
  for (const publicPath of ['dist/client', 'web', 'public']) {
    const relative = path.relative(path.resolve(projectRoot, publicPath), target);
    if (relative === '' || relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)) throw new ApiError(500, 'UNSAFE_STORE', 'Penyimpanan privat tidak boleh berada di direktori frontend publik.');
  }
  for (let current = target; path.dirname(current) !== current; current = path.dirname(current)) {
    try { if ((await lstat(current)).isSymbolicLink()) throw new ApiError(500, 'UNSAFE_STORE', 'Penyimpanan privat tidak boleh melewati symbolic link atau junction.'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
}

export { acquireStoreLock } from './runtime-lock.js';

export async function createApp(options: AppOptions): Promise<SidaksaApp> {
  const { config } = options;
  const store = options.store || await createStore({ directory: config.dataDir, settings: { referenceTabs: config.referenceTabs, syncIntervalMinutes: config.syncIntervalMinutes, retentionDays: config.retentionDays } });
  const authenticate = options.authenticator || createSupabaseAuthenticator({ url: config.supabaseUrl, publishableKey: config.supabasePublishableKey });
  const sync = options.sync || createSyncService({ store, loader: createGoogleSource(config), now: options.now, allowFixtureForTests: options.allowFixtureForTests });
  const app = express() as SidaksaApp;
  app.locals.sidaksa = { config, store, sync };
  app.disable('x-powered-by');
  app.set('query parser', 'simple');
  app.set('trust proxy', false);
  app.use(helmet({ contentSecurityPolicy: options.development ? false : { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], connectSrc: ["'self'", ...(config.authConfigured ? [config.supabaseUrl] : [])], imgSrc: ["'self'", 'data:'], objectSrc: ["'none'"], frameAncestors: ["'none'"], upgradeInsecureRequests: null } }, referrerPolicy: { policy: 'no-referrer' } }));
  app.use('/api', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  app.use('/api', (req, _res, next) => { if (req.originalUrl.length > 8192) throw new ApiError(414, 'URL_TOO_LONG', 'URL permintaan terlalu panjang.'); next(); });
  app.use('/api', rateLimit({ windowMs: 60000, limit: 300, standardHeaders: 'draft-8', legacyHeaders: false, handler: (_req, res) => { res.status(429).json({ error: { code: 'RATE_LIMIT', message: 'Terlalu banyak permintaan. Coba lagi nanti.' } }); } }));
  app.get('/api/health', (_req, res) => { if (app.locals.sidaksa.runtimeId) res.setHeader('X-Sidaksa-Instance', app.locals.sidaksa.runtimeId); res.json({ status: 'ok' }); });
  app.get('/api/public-config', (_req, res) => { res.json(publicConfig(config)); });
  app.use('/api', async (req, res, next) => {
    const header = req.get('Authorization');
    if (!header || !/^Bearer [^\s,]+$/i.test(header) || header.length > 8192) throw new ApiError(401, 'AUTH_REQUIRED', 'Sesi login diperlukan.');
    try {
      const viewer = await authenticate(header.slice(7));
      if (!viewer?.id || !['admin', 'recruiter', 'leader'].includes(viewer.role)) throw new Error('Invalid verifier response');
      res.locals.viewer = viewer;
    } catch (error) {
      if (error instanceof ApiError && ['AUTH_UNCONFIGURED', 'AUTH_UNAVAILABLE', 'ACCOUNT_NOT_APPROVED', 'INVALID_TOKEN'].includes(error.code)) throw error;
      throw new ApiError(503, 'AUTH_UNAVAILABLE', 'Layanan autentikasi tidak tersedia.');
    }
    next();
  });
  app.use('/api', (req, _res, next) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      const origin = req.get('Origin'), site = req.get('Sec-Fetch-Site');
      if (origin !== undefined && origin !== config.appOrigin || site === 'cross-site' || site === 'same-site' || !origin && site && site !== 'same-origin' && site !== 'none') throw new ApiError(403, 'ORIGIN_REJECTED', 'Asal permintaan tidak diizinkan.');
      if ((req.get('Content-Length') && req.get('Content-Length') !== '0' || req.get('Transfer-Encoding')) && !req.is('application/json')) throw new ApiError(415, 'JSON_REQUIRED', 'Permintaan harus menggunakan JSON.');
    }
    next();
  });
  app.use('/api', rateLimit({ windowMs: 60000, limit: 30, keyGenerator: (_req, res) => (res.locals.viewer as Viewer).id, skip: req => !['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method), standardHeaders: 'draft-8', legacyHeaders: false, handler: (_req, res) => { res.status(429).json({ error: { code: 'RATE_LIMIT', message: 'Terlalu banyak perubahan. Coba lagi nanti.' } }); } }));
  app.use('/api', express.json({ limit: '16kb', strict: true, inflate: false }));
  app.get('/api/me', noQuery, (_req, res) => { const user = res.locals.viewer as Viewer; res.json({ user, permissions: permissions(user.role) }); });
  let cachedRevision: number | undefined;
  let cachedSnapshot: Snapshot | null = null;
  const currentSnapshot = (): Snapshot | null => {
    const revision = store.revision?.();
    if (revision !== undefined && revision === cachedRevision) return cachedSnapshot;
    const state = store.read(), snapshot = state.snapshot;
    cachedRevision = revision; cachedSnapshot = null;
    if (!snapshot || snapshot.source !== 'google-sheets' && !options.allowFixtureForTests) return null;
    if (!options.allowFixtureForTests && snapshot.spreadsheetId !== config.spreadsheetId) return null;
    const reviews = new Map(state.reviews.filter(r => r.snapshotId === snapshot.id).map(r => [r.issueId, r]));
    snapshot.issues = snapshot.issues.map(issue => {
      const review = reviews.get(issue.id);
      return review ? { ...issue, status: review.status, reviewNote: review.note, reviewedAt: review.at, reviewedBy: review.by } : issue;
    });
    const approved = new Set(state.settings.referenceTabs);
    if (!approved.has('Crew List Departure')) { snapshot.departures = []; snapshot.counts.crewRows = null; snapshot.referenceStats.crewRows = null; }
    if (!approved.has('Funnel Rekap')) { snapshot.counts.funnelRows = null; snapshot.referenceStats.funnelRows = null; }
    snapshot.referenceStats.approvedReferenceTabs = snapshot.referenceStats.approvedReferenceTabs.filter(t => approved.has(t));
    snapshot.issues = snapshot.issues.filter(i => !['Crew List Departure', 'Funnel Rekap'].includes(i.source.sheet) || approved.has(i.source.sheet));
    cachedSnapshot = snapshot;
    return snapshot;
  };
  const snapshot = (query?: Pick<ParsedQuery, 'snapshotId'>): Snapshot => {
    const value = currentSnapshot();
    if (!value) throw new ApiError(503, 'SNAPSHOT_UNAVAILABLE', 'Snapshot Google Sheets belum tersedia.');
    if (query?.snapshotId !== undefined && query.snapshotId !== value.id) throw new ApiError(409, 'SNAPSHOT_CHANGED', 'Snapshot tampilan telah berubah. Muat data terbaru sebelum melanjutkan; ekspor tidak dijalankan ulang otomatis.');
    return value;
  };
  const requireCrew = (s: Snapshot) => {
    if (!store.read().settings.referenceTabs.includes('Crew List Departure') || !s.referenceStats.approvedReferenceTabs.includes('Crew List Departure')) throw new ApiError(503, 'REFERENCE_UNAVAILABLE', 'Tab referensi Crew List Departure belum tersedia atau belum disetujui.');
  };
  app.get('/api/status', noQuery, (_req, res) => {
    const state = store.read(), s = currentSnapshot();
    const syncState = !s && state.snapshot ? { ...state.sync, lastSuccessAt: null, state: state.sync.state === 'ok' ? 'never' as const : state.sync.state, message: state.sync.message || 'Cache bukan snapshot Google Sheets untuk sumber aktif; sinkronisasi diperlukan.' } : state.sync;
    res.json({ sourceMode: 'google-sheets', authConfigured: config.authConfigured, sheetsConfigured: config.sheetsConfigured, spreadsheetId: config.spreadsheetId, requiredTabs: REQUIRED_TABS, referenceTabs: state.settings.referenceTabs, sync: syncState, snapshot: s ? { id: s.id, source: s.source, createdAt: s.createdAt, counts: s.counts, issueCount: s.issues.length } : null });
  });
  app.get('/api/dictionaries', noQuery, (_req, res) => { res.json(dictionaries(snapshot())); });
  app.get('/api/overview', (req, res) => { const query = parseQuery(req.query, applicationFilters); res.json(overview(snapshot(query), query.filters)); });
  app.get('/api/applications', (req, res) => {
    const query = parseQuery(req.query, applicationFilters, applicationSorts), s = snapshot(query), selected = applicationsFor(s, query.filters);
    res.json(project(list(s, selected.rows, query, selected.excludedDatePrecision), res.locals.viewer));
  });
  app.get('/api/applications/:id', (req, res) => {
    const s = snapshot(parseQuery(req.query, [])), row = s.applications.find(a => a.id === req.params.id);
    if (!row) throw new ApiError(404, 'NOT_FOUND', 'Lamaran tidak ditemukan.');
    const candidates = s.candidates.filter(c => c.id === row.candidateId);
    res.json(project({ row, candidate: row.identityVerified && candidates.length === 1 ? candidates[0] : null, issues: s.issues.filter(i => i.entityId === row.id || (row.identityVerified && i.entityType === 'candidate' && i.entityId === row.candidateId)), meta: meta(s) }, res.locals.viewer));
  });
  app.get('/api/candidates', (req, res) => { const query = parseQuery(req.query, candidateFilters, candidateSorts), s = snapshot(query); res.json(project(list(s, candidatesFor(s, query.filters), query), res.locals.viewer)); });
  app.get('/api/candidates/:id', (req, res) => {
    const s = snapshot(parseQuery(req.query, [])), matches = s.candidates.filter(c => c.id === req.params.id);
    if (!matches.length) throw new ApiError(404, 'NOT_FOUND', 'Kandidat tidak ditemukan.');
    if (matches.length !== 1) throw new ApiError(409, 'AMBIGUOUS_ID', 'ID kandidat berulang; identitas perlu ditinjau.');
    const applications = s.applications.filter(a => a.candidateId === req.params.id), ids = new Set(applications.map(a => a.id));
    res.json(project({ row: matches[0], applications, issues: s.issues.filter(i => i.entityType === 'candidate' && i.entityId === req.params.id || i.entityType === 'application' && ids.has(i.entityId)), meta: meta(s) }, res.locals.viewer));
  });
  app.get('/api/partners', (req, res) => {
    const query = parseQuery(req.query, applicationFilters, partnerSorts, ['kind']), s = snapshot(query), kind = query.extras.kind || 'agents';
    if (kind !== 'agents' && kind !== 'companies') throw badQuery();
    const selected = partnersFor(s, kind, query.filters);
    res.json(project(list(s, selected.rows, query, selected.excludedDatePrecision), res.locals.viewer));
  });
  app.get('/api/departures', (req, res) => {
    const query = parseQuery(req.query, departureFilters, departureSorts), s = snapshot(query); requireCrew(s); const selected = departuresFor(s, query.filters);
    res.json(list(s, selected.rows, query, selected.excludedDatePrecision));
  });
  app.get('/api/issues', (req, res) => {
    const query = parseQuery(req.query, issueFilters, issueSorts), s = snapshot(query), f = query.filters;
    const rows = s.issues.filter(i => (!f.q || [i.code, i.message, i.entityId, i.source.sheet, i.source.row].some(v => String(v).toLocaleLowerCase('id').includes(f.q!.toLocaleLowerCase('id')))) && (!f.code || i.code === f.code) && (!f.severity || i.severity === f.severity) && (!f.reviewStatus || i.status === f.reviewStatus));
    res.json(project(list(s, rows, query), res.locals.viewer));
  });
  app.post('/api/issues/:id/review', adminOnly, noQuery, async (req, res) => {
    const value = body(reviewBody, req.body);
    snapshot();
    await store.update(s => {
      if (!s.snapshot || s.snapshot.id !== value.snapshotId) throw new ApiError(409, 'STALE_SNAPSHOT', 'Snapshot telah berubah. Muat ulang sebelum meninjau masalah.');
      if (!s.snapshot.issues.some(i => i.id === req.params.id)) throw new ApiError(404, 'NOT_FOUND', 'Masalah data tidak ditemukan.');
      const at = (options.now?.() || new Date()).toISOString();
      s.reviews = s.reviews.filter(r => r.snapshotId !== value.snapshotId || r.issueId !== req.params.id);
      s.reviews.push({ snapshotId: value.snapshotId, issueId: req.params.id as string, status: value.status, note: value.note, at, by: res.locals.viewer.id });
      s.audit.push({ id: randomUUID(), at, actorId: res.locals.viewer.id, action: 'issue.review', result: 'ok', details: { snapshotId: value.snapshotId, issueId: req.params.id as string, status: value.status } });
    });
    res.json({ row: snapshot().issues.find(i => i.id === req.params.id), snapshotId: value.snapshotId });
  });
  const settings = () => ({ sourceMode: 'google-sheets' as const, spreadsheetId: config.spreadsheetId, requiredTabs: [...REQUIRED_TABS], ...store.read().settings, authConfigured: config.authConfigured, sheetsConfigured: config.sheetsConfigured, credentialConfigured: config.credentialConfigured, googleOAuthEnabled: config.googleOAuthEnabled });
  app.get('/api/settings', adminOnly, noQuery, (_req, res) => { res.json(settings()); });
  app.put('/api/settings', adminOnly, noQuery, async (req, res) => {
    const value = body(settingsBody, req.body);
    await store.update(s => {
      if (s.sync.state === 'running') throw new ApiError(409, 'SYNC_RUNNING', 'Tunggu sampai sinkronisasi selesai.');
      s.settings = value;
      s.audit.push({ id: randomUUID(), at: (options.now?.() || new Date()).toISOString(), actorId: res.locals.viewer.id, action: 'settings.update', result: 'ok', details: { referenceTabs: value.referenceTabs.join(','), syncIntervalMinutes: value.syncIntervalMinutes, retentionDays: value.retentionDays } });
    });
    await sync.reschedule();
    res.json(settings());
  });
  const syncLimiter = rateLimit({ windowMs: 60000, limit: 3, keyGenerator: (_req, res) => (res.locals.viewer as Viewer).id, standardHeaders: 'draft-8', legacyHeaders: false, handler: (_req, res) => { res.status(429).json({ error: { code: 'SYNC_RATE_LIMIT', message: 'Refresh terlalu sering. Coba lagi nanti.' } }); } });
  app.post('/api/sync', adminOnly, noQuery, async (req, _res, next) => { body(z.object({}).strict(), req.body ?? {}); next(); }, syncLimiter, async (_req, res) => {
    const state = await sync.refresh(res.locals.viewer.id), s = currentSnapshot();
    res.json({ sync: state, snapshot: s ? { id: s.id, source: s.source, createdAt: s.createdAt, counts: s.counts, issueCount: s.issues.length } : null });
  });
  app.get('/api/mappings', adminOnly, noQuery, (_req, res) => {
    const state = store.read();
    assertMappingSource(state, options.allowFixtureForTests && state.snapshot ? state.snapshot : { source: 'google-sheets', spreadsheetId: config.spreadsheetId });
    if (state.snapshot) snapshot();
    res.json({ rows: state.mappings });
  });
  app.post('/api/mappings', adminOnly, noQuery, async (req, res) => {
    const value = body(mappingBody, req.body);
    snapshot();
    let decision!: MappingDecision, publishedId!: string;
    await store.update(s => {
      if (s.sync.state === 'running') throw new ApiError(409, 'SYNC_RUNNING', 'Tunggu sampai sinkronisasi selesai.');
      if (!s.snapshot || !s.raw || s.snapshot.id !== value.snapshotId) throw new ApiError(409, 'STALE_SNAPSHOT', 'Snapshot telah berubah. Muat ulang sebelum menyimpan mapping.');
      assertMappingSource(s, options.allowFixtureForTests ? s.snapshot : { source: 'google-sheets', spreadsheetId: config.spreadsheetId });
      const rows = value.kind === 'agent' ? s.snapshot.agents : s.snapshot.companies;
      const targets = rows.filter(p => p.id === value.targetId);
      if (targets.length !== 1 || !targets[0]!.name.trim()) throw new ApiError(400, 'INVALID_MAPPING_TARGET', 'Target mapping harus satu master bernama dengan ID unik.');
      const aliasMatches = rows.filter(p => p.id === value.alias || p.name === value.alias);
      const alreadyResolved = aliasMatches.length === 1 && rows.filter(p => p.id === aliasMatches[0]!.id).length === 1 && aliasMatches[0]!.name.trim();
      if (s.mappings.some(m => m.kind === value.kind && m.alias === value.alias) || rows.some(p => p.id === value.alias) || alreadyResolved) throw new ApiError(409, 'MAPPING_COLLISION', 'Alias mapping sudah digunakan atau bertabrakan dengan master unik.');
      if (!s.snapshot.applications.some(a => (value.kind === 'agent' ? a.agent : a.company) === value.alias)) throw new ApiError(400, 'UNKNOWN_MAPPING_ALIAS', 'Alias tidak ditemukan pada sumber snapshot ini.');
      decision = { id: randomUUID(), kind: value.kind, alias: value.alias, targetId: value.targetId, reason: value.reason, createdAt: (options.now?.() || new Date()).toISOString(), createdBy: res.locals.viewer.id };
      s.mappings.push(decision);
      s.snapshot = normalizeWorkbook(s.raw, { referenceTabs: s.snapshot.referenceStats.approvedReferenceTabs, mappings: s.mappings });
      publishedId = s.snapshot.id;
      s.audit.push({ id: randomUUID(), at: decision.createdAt, actorId: res.locals.viewer.id, action: 'mapping.publish', result: 'ok', details: { mappingId: decision.id, kind: value.kind, previousSnapshotId: value.snapshotId, snapshotId: publishedId } });
    });
    res.status(201).json({ row: decision, snapshotId: publishedId });
  });
  app.get('/api/audit', adminOnly, (req, res) => {
    const query = parseQuery(req.query, ['q'], ['at', 'action', 'result', 'actorId', 'id']), s = query.snapshotId === undefined ? currentSnapshot() : snapshot(query), q = query.filters.q?.toLocaleLowerCase('id');
    const rows = store.read().audit.filter(a => !q || [a.action, a.actorId, a.result].some(v => v.toLocaleLowerCase('id').includes(q)));
    if (!query.sort) { query.sort = 'at'; query.direction = 'desc'; }
    const response: AuditListResponse = {
      rows: ordered(rows, query).slice((query.page - 1) * query.limit, query.page * query.limit),
      pagination: { page: query.page, limit: query.limit, total: rows.length, totalPages: Math.ceil(rows.length / query.limit) },
      meta: { kind: 'audit', generatedAt: (options.now?.() || new Date()).toISOString(), filters: query.filters, sourceSnapshot: s ? { snapshotId: s.id, source: s.source, createdAt: s.createdAt } : null },
    };
    res.json(response);
  });
  const exportLimiter = rateLimit({ windowMs: 60000, limit: 20, keyGenerator: (_req, res) => (res.locals.viewer as Viewer).id, standardHeaders: 'draft-8', legacyHeaders: false, handler: (_req, res) => { res.status(429).json({ error: { code: 'EXPORT_RATE_LIMIT', message: 'Ekspor terlalu sering. Coba lagi nanti.' } }); } });
  app.get('/api/export', exportLimiter, async (req, res) => {
    if (typeof req.query.kind !== 'string' || !['aggregate', 'applications', 'candidates', 'departures', 'partners'].includes(req.query.kind)) throw badQuery();
    const kind = req.query.kind as ExportKind;
    const viewer = res.locals.viewer as Viewer;
    if (viewer.role === 'leader' && (kind !== 'aggregate' || req.query.contacts === 'true')) throw new ApiError(403, 'EXPORT_FORBIDDEN', 'Peran pimpinan hanya dapat mengekspor agregat tanpa kontak.');
    const filters = kind === 'candidates' ? candidateFilters : kind === 'departures' ? departureFilters : applicationFilters;
    const sorts = kind === 'candidates' ? candidateSorts : kind === 'departures' ? departureSorts : kind === 'partners' ? partnerSorts : kind === 'applications' ? applicationSorts : [];
    const query = parseQuery(req.query, filters, sorts, ['kind', 'contacts', ...(kind === 'partners' ? ['partnerKind'] : [])]);
    if (query.extras.contacts !== undefined && !['true', 'false'].includes(query.extras.contacts)) throw badQuery();
    const partnerKind = query.extras.partnerKind || 'agents';
    if (partnerKind !== 'agents' && partnerKind !== 'companies') throw badQuery();
    const s = snapshot(query);
    if (kind === 'departures') requireCrew(s);
    const data = { ...s };
    if (kind === 'applications') data.applications = ordered(s.applications, query);
    if (kind === 'candidates') data.candidates = ordered(s.candidates, query);
    if (kind === 'departures') data.departures = ordered(s.departures, query);
    const contacts = query.extras.contacts === 'true' && permissions(viewer.role).viewContact;
    const csv = csvExport(data, kind, query.filters, contacts, partnerKind, rows => ordered(rows, query));
    await store.update(state => { state.audit.push({ id: randomUUID(), at: (options.now?.() || new Date()).toISOString(), actorId: viewer.id, action: 'export.csv', result: 'ok', details: { kind, snapshotId: s.id, contacts } }); });
    res.setHeader('Content-Disposition', `attachment; filename="sidaksa-${kind}.csv"`);
    res.type('text/csv; charset=utf-8').send(csv);
  });
  app.use('/api', (_req, _res, next) => { next(new ApiError(404, 'NOT_FOUND', 'Endpoint tidak ditemukan.')); });
  // Kept on the API router so startup may safely add SPA/static middleware later.
  const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
    if (error instanceof ApiError) { res.status(error.status).json({ error: { code: error.code, message: error.message } }); return; }
    if (error?.type === 'entity.too.large') { res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Isi permintaan terlalu besar.' } }); return; }
    if (error?.type === 'entity.parse.failed') { res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Isi JSON tidak valid.' } }); return; }
    if (error?.status === 415) { res.status(415).json({ error: { code: 'UNSUPPORTED_ENCODING', message: 'Encoding permintaan tidak didukung.' } }); return; }
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Permintaan tidak dapat diproses.' } });
  };
  app.use('/api', errorHandler);
  return app;
}
