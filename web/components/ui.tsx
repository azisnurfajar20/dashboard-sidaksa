import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, CircleAlert, Database, ExternalLink, FileSearch, RefreshCw, X } from 'lucide-react';
import type { AppStatus, DataMeta, DateValue, Pagination, SourceRef } from '../../shared/contracts';
import { dateText, filled, number, precisionLabel, sourceLink, wibTime } from '../lib/format';
export function PageHeader({ title, eyebrow, description, actions }: { title: string; eyebrow?: string; description: string; actions?: ReactNode }) {
  return <header className="page-header"><div><p className="section-kicker">{eyebrow ?? 'RUANG KERJA'}</p><h1 tabIndex={-1} id="page-title">{title}</h1><p>{description}</p></div>{actions && <div className="page-actions">{actions}</div>}</header>;
}
export function DataState({ state, message, onRetry, retryLabel = 'Coba lagi' }: { state: 'loading' | 'empty' | 'setup' | 'error'; message?: string | null; onRetry?: () => void; retryLabel?: string }) {
  const titles = { loading: 'Memuat data…', empty: 'Tidak ada hasil', setup: 'Belum ada snapshot tersedia', error: 'Data tidak dapat dimuat' };
  return <div className={`data-state data-state-${state}`} role={state === 'error' ? 'alert' : 'status'} data-testid={`state-${state}`}>{state === 'loading' ? <span className="spinner-border spinner-border-sm" aria-hidden="true"/> : <FileSearch size={28} aria-hidden="true"/>}<h2>{titles[state]}</h2><p>{message ?? (state === 'empty' ? 'Tidak ada baris yang cocok dengan filter ini. Ubah atau hapus filter untuk melihat data lainnya.' : state === 'setup' ? 'Integrasi sumber perlu disiapkan dan sinkronisasi harus berhasil sebelum angka dapat ditampilkan.' : state === 'loading' ? 'Mengambil data dari snapshot yang diizinkan.' : 'Coba lagi atau hubungi admin organisasi.')}</p>{onRetry && <button type="button" className="btn btn-outline-primary" onClick={onRetry}><RefreshCw size={16} aria-hidden="true"/> {retryLabel}</button>}</div>;
}
export function SourceBanner({ status }: { status: AppStatus }) {
  const snapshot = status.snapshot; const failed = status.sync.state === 'failed'; const test = snapshot?.source === 'fixture';
  return <section className={`source-banner ${failed || !snapshot ? 'source-warning' : ''}`} aria-label="Status sumber" data-testid="source-status"><div className="source-summary"><Database size={17} aria-hidden="true"/><strong>{test ? 'SUMBER UJI — fixture, bukan produksi' : 'Google Sheets privat'}</strong><span className="source-separator"/><span className={`status-dot ${failed ? 'status-dot-warning' : ''}`} aria-hidden="true"/><span>{failed ? 'Sinkronisasi gagal' : status.sync.state === 'running' ? 'Sinkronisasi berjalan' : !status.sheetsConfigured ? 'Integrasi belum dikonfigurasi' : !snapshot ? 'Belum ada snapshot' : 'Snapshot tersedia'}</span></div><div className="source-meta">{snapshot ? <><span>Snapshot sumber (status) <code title={snapshot.id}>{snapshot.id}</code></span><span>{wibTime(snapshot.createdAt)}</span></> : <span>Angka belum tersedia — bukan nol.</span>}</div>{failed && <p><CircleAlert size={16} aria-hidden="true"/> {snapshot ? 'Sumber mempertahankan snapshot terakhir yang berhasil. Identitas tampilan mengikuti metadata pada data; data mungkin kedaluwarsa.' : 'Belum ada snapshot yang berhasil. Tidak ada data pengganti.'} Keberhasilan terakhir: {wibTime(status.sync.lastSuccessAt)}.</p>}</section>;
}
export function MetaLine({ meta }: { meta: DataMeta }) { return <div className="meta-line"><span>{meta.source === 'fixture' ? 'SUMBER UJI / fixture' : 'Google Sheets'} · Snapshot <code>{meta.snapshotId}</code></span><span>{wibTime(meta.createdAt)}</span>{meta.excludedDatePrecision > 0 && <p className="precision-warning" role="status">{number(meta.excludedDatePrecision)} baris tidak tercakup karena presisi tanggal tidak sesuai batas periode. Tanggal bulan saja tidak diubah menjadi tanggal harian.</p>}</div>; }
export function DateCell({ date }: { date: DateValue }) { return <span className="date-cell"><span>{dateText(date)}</span>{date.precision !== 'day' && <small>{precisionLabel[date.precision]}</small>}</span>; }
export function ValueBadge({ value, warning = false }: { value: string | null | undefined; warning?: boolean }) { return <span className={`value-badge ${warning || !value ? 'value-warning' : ''}`}>{filled(value)}</span>; }
export function IssueFlag({ codes }: { codes: string[] }) { return codes.length ? <span className="issue-flag" title={codes.join(', ')}><CircleAlert size={13} aria-hidden="true"/>{codes.length} masalah</span> : <span className="text-secondary small">—</span>; }
export function SourceCoordinate({ source, spreadsheetId }: { source: SourceRef; spreadsheetId?: string | null }) { const href = sourceLink(spreadsheetId, source); const label = `${source.sheet}!${source.cell ?? `baris ${source.row}`}`; return href ? <a className="source-link" href={href} target="_blank" rel="noopener noreferrer" title="Buka sumber; izin Google tetap berlaku">{label}<ExternalLink size={12} aria-hidden="true"/></a> : <span className="source-link">{label}</span>; }
export function Pager({ pagination, onPage }: { pagination: Pagination; onPage?: (page: number) => void }) {
  const { page, total, totalPages, limit } = pagination; const start = total ? (page - 1) * limit + 1 : 0; const end = Math.min(page * limit, total);
  return <nav className="table-pager" aria-label="Paginasi"><span>{number(start)}–{number(end)} dari <strong>{number(total)}</strong> baris</span><div><button type="button" className="btn btn-outline-secondary icon-button" aria-label="Halaman sebelumnya" disabled={page <= 1 || !onPage} onClick={() => onPage?.(page - 1)} data-testid="page-previous"><ChevronLeft size={17}/></button><span>Halaman {number(page)} / {number(Math.max(totalPages, 1))}</span><button type="button" className="btn btn-outline-secondary icon-button" aria-label="Halaman berikutnya" disabled={page >= totalPages || !onPage} onClick={() => onPage?.(page + 1)} data-testid="page-next"><ChevronRight size={17}/></button></div></nav>;
}
export interface Column<T> { key: string; label: string; render: (row: T) => ReactNode; sortable?: boolean; className?: string }
export function DataTable<T extends { id: string }>({ rows, columns, caption, sort, direction, onSort }: { rows: T[]; columns: Column<T>[]; caption: string; sort?: string; direction?: string; onSort?: (key: string) => void }) {
  return <div className="table-responsive" tabIndex={0} role="region" aria-label={caption}><table className="table align-middle mb-0"><caption className="visually-hidden">{caption}</caption><thead><tr>{columns.map(column => <th key={column.key} scope="col" className={column.className} aria-sort={sort === column.key ? direction === 'desc' ? 'descending' : 'ascending' : undefined}>{column.sortable && onSort ? <button className="table-sort" type="button" onClick={() => onSort(column.key)} data-testid={`sort-${column.key}`}>{column.label}{sort === column.key ? direction === 'desc' ? <ArrowDown size={13}/> : <ArrowUp size={13}/> : <ArrowUpDown size={13}/>}</button> : column.label}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={`${row.id}:${index}`} data-testid="data-row">{columns.map(column => <td key={column.key} className={column.className}>{column.render(row)}</td>)}</tr>)}</tbody></table></div>;
}
export function Modal({ title, onClose, children, wide = true }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null); const id = useId(); const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null; const overflow = document.body.style.overflow; document.body.style.overflow = 'hidden'; ref.current?.focus({ preventScroll: true });
    const key = (event: KeyboardEvent) => {
      const dialog = ref.current;
      // Auth verification retains this component but hides/inerts its private tree.
      if (!dialog || dialog.closest('[hidden], [inert]') || !dialog.getClientRects().length) return;
      if (event.key === 'Escape') { event.preventDefault(); close.current(); }
      if (event.key !== 'Tab') return;
      const elements = dialog.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]');
      if (!elements.length) { event.preventDefault(); return; }
      const first = elements[0]; const last = elements[elements.length - 1];
      const outside = document.activeElement === dialog || !dialog.contains(document.activeElement);
      if (event.shiftKey && (document.activeElement === first || outside)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || outside)) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', key); return () => {
      document.body.style.overflow = overflow; document.removeEventListener('keydown', key);
      const target = previous?.isConnected ? previous : document.getElementById('page-title');
      // A refetch can replace the opener. Never focus a retained hidden/inert auth tree.
      if (target && !target.closest('[hidden], [inert]') && target.getClientRects().length) target.focus({ preventScroll: true });
    };
  }, []);
  return <div className="modal modal-layer" onMouseDown={event => { if (event.target === event.currentTarget) { event.preventDefault(); onClose(); } }}><div className={`modal-dialog ${wide ? 'modal-xl' : ''}`} role="dialog" aria-modal="true" aria-labelledby={id} tabIndex={-1} ref={ref} data-testid="detail-modal"><div className="modal-content"><div className="modal-header"><h2 className="modal-title" id={id}>{title}</h2><button type="button" className="btn icon-button" onClick={onClose} aria-label="Tutup rincian" data-testid="modal-close"><X size={20}/></button></div><div className="modal-body">{children}</div></div></div></div>;
}
export function DefinitionList({ values }: { values: [string, ReactNode][] }) { return <dl className="detail-grid">{values.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>; }
export function EvidenceNotice() { return <div className="evidence-note">Bukti yang tersedia pada snapshot ini, bukan riwayat perpindahan tahap. Tahap yang dilewati tidak diasumsikan pernah terjadi.</div>; }
export function GoToQuality({ count }: { count: number }) { return <Link to="/kualitas-data" className="quality-link"><CircleAlert size={17} aria-hidden="true"/>{number(count)} masalah data <ChevronRight size={16} aria-hidden="true"/></Link>; }
