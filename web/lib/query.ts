import type { QueryFilters, SnapshotReadContext } from '../../shared/contracts';
export type ViewQuery = QueryFilters & SnapshotReadContext & { page?: string; limit?: string; sort?: string; direction?: string; kind?: string; partnerKind?: string };
export const filterKeys: (keyof QueryFilters)[] = ['metric', 'q', 'from', 'to', 'agent', 'company', 'country', 'workBase', 'position', 'status', 'finalResult', 'stage', 'year', 'category', 'issue', 'severity', 'code', 'reviewStatus'];
const keys = [...filterKeys, 'snapshotId', 'page', 'limit', 'sort', 'direction', 'kind', 'partnerKind'];
export function readQuery(params: URLSearchParams): ViewQuery { return Object.fromEntries([...params].filter(([key, value]) => keys.includes(key) && value !== '')); }
export function buildQuery(query: ViewQuery): string { const params = new URLSearchParams(); for (const [key, value] of Object.entries(query)) if (keys.includes(key) && value !== undefined && value !== '') params.set(key, String(value)); return params.toString(); }
export function changeFilters(params: URLSearchParams, changes: Partial<ViewQuery>): URLSearchParams { const next = new URLSearchParams(params); for (const [key, value] of Object.entries(changes)) { if (value === undefined || value === '') next.delete(key); else next.set(key, value); } next.set('page', '1'); return next; }
export function apiPath(path: string, query: ViewQuery) { const text = buildQuery(query); return text ? `${path}?${text}` : path; }
