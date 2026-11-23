import { ApiClient } from './api';
import { buildQuery, type ViewQuery } from './query';
export type ExportKind = 'aggregate' | 'applications' | 'candidates' | 'departures' | 'partners';
export function saveBrowserBlob(blob: Blob, filename: string): void { const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
export async function exportCsv(api: ApiClient, kind: ExportKind, filters: ViewQuery, save: (blob: Blob, filename: string) => void | Promise<void> = saveBrowserBlob, signal?: AbortSignal) { const { page: _page, limit: _limit, kind: _kind, ...query } = filters; const blob = await api.csv(`/api/export?${buildQuery({ ...query, kind })}`, signal); await save(blob, `SIDAKSA-${kind}.csv`); }
