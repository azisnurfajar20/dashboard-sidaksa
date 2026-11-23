import type { DateValue, SourceRef } from '../../shared/contracts';
export const number = (value: number | null | undefined) => value == null ? '—' : new Intl.NumberFormat('id-ID').format(value);
export const filled = (value: string | null | undefined) => value?.trim() ? value : 'Belum diisi';
export function dateText(date: DateValue) { return date.precision === 'empty' ? 'Belum diisi' : date.display || date.raw || 'Tidak diketahui'; }
export const precisionLabel: Record<DateValue['precision'], string> = { day: 'Tanggal harian', month: 'Bulan saja', range: 'Rentang', unknown: 'Tidak diketahui', empty: 'Belum diisi' };
export function wibTime(value: string | null | undefined) {
  if (!value) return 'Belum tersedia'; const date = new Date(value); if (!Number.isFinite(date.getTime())) return 'Tidak diketahui';
  return `${new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta', hour12: false }).format(date)} WIB`;
}
export function sourceLink(spreadsheetId: string | null | undefined, source: SourceRef): string | null {
  if (!spreadsheetId || !/^[a-zA-Z0-9_-]+$/.test(spreadsheetId) || !Number.isSafeInteger(source.row) || source.row < 1 || !source.sheet || /[\r\n]/.test(source.sheet)) return null;
  const cell = source.cell && /^[A-Z]+[1-9]\d*$/.test(source.cell) ? source.cell : `A${source.row}`;
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit#range=${encodeURIComponent(`'${source.sheet.replaceAll("'", "''")}'!${cell}`)}`;
}
