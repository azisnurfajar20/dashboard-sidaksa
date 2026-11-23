import { useEffect, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { ApiError } from '../lib/api';
import { exportCsv, type ExportKind } from '../lib/export';
import type { ViewQuery } from '../lib/query';
export function ExportButton({ kind, filters, snapshotId, onLoadLatest, available = true }: { kind: ExportKind; filters: ViewQuery; snapshotId?: string; onLoadLatest?: () => void; available?: boolean }) {
  const { api, session } = useAuth(); const allowed = kind === 'aggregate' || !!session.me?.permissions.exportDetail; const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null); const [stale, setStale] = useState(false); const abort = useRef<AbortController | null>(null);
  useEffect(() => { setError(null); setStale(false); }, [snapshotId]);
  useEffect(() => () => { abort.current?.abort(); }, []);
  async function download() { if (!allowed || !available || !snapshotId || busy) return; abort.current?.abort(); const controller = new AbortController(); abort.current = controller; setBusy(true); setError(null); try { await exportCsv(api, kind, { ...filters, snapshotId }, undefined, controller.signal); } catch (reason) { if (!controller.signal.aborted) { setError(reason instanceof Error ? reason.message : 'Ekspor tidak dapat diproses.'); setStale(reason instanceof ApiError && reason.code === 'SNAPSHOT_CHANGED'); } } finally { if (!controller.signal.aborted) setBusy(false); } }
  return <div className="export-control"><button type="button" className="btn btn-outline-primary" disabled={!allowed || !available || !snapshotId || busy} title={!allowed ? 'Izin ekspor detail diperlukan' : 'CSV sesuai filter, tanpa kontak secara default; metadata snapshot disertakan'} onClick={() => void download()} data-testid={`export-${kind}`}><Download size={16} aria-hidden="true"/>{busy ? 'Menyiapkan…' : kind === 'aggregate' ? 'Ekspor agregat' : 'Ekspor CSV'}</button>{error && <div className="export-error" role="alert"><p>{error}</p>{stale && onLoadLatest && <button type="button" className="btn btn-outline-primary btn-sm" onClick={() => { setError(null); setStale(false); onLoadLatest(); }}>Muat data terbaru</button>}</div>}</div>;
}
