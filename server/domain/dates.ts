import type { DateValue, RawCell } from '../../shared/contracts.js';

const months: Record<string, number> = {
  jan: 1, januari: 1, january: 1, feb: 2, februari: 2, february: 2,
  mar: 3, maret: 3, march: 3, apr: 4, april: 4, mei: 5, may: 5,
  jun: 6, juni: 6, june: 6, jul: 7, juli: 7, july: 7, agu: 8, agt: 8, agustus: 8, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, okt: 10, oktober: 10, oct: 10, october: 10,
  nov: 11, november: 11, des: 12, desember: 12, dec: 12, december: 12,
};
const pad = (n: number) => String(n).padStart(2, '0');
function validDay(y: number, m: number, d: number): string | null {
  const date = new Date(Date.UTC(y, m - 1, d));
  return y >= 1900 && y <= 2200 && date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
    ? `${y}-${pad(m)}-${pad(d)}` : null;
}
function year(s: string): number { const n = Number(s); return s.length === 2 ? 2000 + n : n; }
function textDate(raw: string): { iso: string | null; precision: DateValue['precision'] } {
  // A four-digit year makes two-part numeric month displays unambiguous.
  const numericMonth = raw.trim().match(/^(?:(\d{1,2})[/.\-](\d{4})|(\d{4})[/.\-](\d{1,2}))$/);
  if (numericMonth) {
    const iso = validDay(+(numericMonth[2] || numericMonth[3]!), +(numericMonth[1] || numericMonth[4]!), 1);
    return { iso: iso?.slice(0, 7) || null, precision: iso ? 'month' : 'unknown' };
  }
  const s = raw.trim().toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ');
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) return { iso: validDay(+m[1]!, +m[2]!, +m[3]!), precision: 'day' };
  if ((m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/))) return { iso: validDay(year(m[3]!), +m[2]!, +m[1]!), precision: 'day' };
  if ((m = s.match(/^(\d{1,2})[\s-]+([a-z]+)[\s,-]+(\d{2}|\d{4})$/)) && months[m[2]!]) return { iso: validDay(year(m[3]!), months[m[2]!]!, +m[1]!), precision: 'day' };
  if ((m = s.match(/^([a-z]+)\s+(\d{1,2}),?\s+(\d{4})$/)) && months[m[1]!]) return { iso: validDay(+m[3]!, months[m[1]!]!, +m[2]!), precision: 'day' };
  if ((m = s.match(/^([a-z]+)[\s-]+(\d{2}|\d{4})$/)) && months[m[1]!]) {
    const iso = validDay(year(m[2]!), months[m[1]!]!, 1);
    return { iso: iso?.slice(0, 7) || null, precision: iso ? 'month' : 'unknown' };
  }
  if ((m = s.match(/^(\d{4})-(\d{2})$/)) && +m[2]! >= 1 && +m[2]! <= 12) return { iso: s, precision: 'month' };
  return { iso: null, precision: /\d\s*[-–]\s*\d/.test(s) ? 'range' : 'unknown' };
}
export function parseDate(cell: RawCell | undefined): DateValue {
  const raw = cell?.value == null ? '' : String(cell.value);
  const display = cell?.formatted?.trim() || raw;
  if (!raw.trim() && !display.trim()) return { raw, iso: null, precision: 'empty', display: '' };
  const fmt = (cell?.numberFormat || '').replace(/"[^"]*"|\[[^\]]*\]/g, '').toLowerCase();
  let parsed = textDate(display);
  if (typeof cell?.value === 'number' && Number.isFinite(cell.value) && cell.value > 0 && cell.value < 110000) {
    const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(cell.value) * 86400000);
    const iso = date.toISOString().slice(0, 10);
    const monthOnly = (/[my]/.test(fmt) && !/d/.test(fmt)) || parsed.precision === 'month';
    const ambiguousDisplay = !parsed.iso && /^\d{1,4}[/.\-]\d{1,4}$/.test(display) && !/[dy]/.test(fmt);
    parsed = ambiguousDisplay ? { iso: null, precision: 'unknown' }
      : { iso: monthOnly ? iso.slice(0, 7) : iso, precision: monthOnly ? 'month' : 'day' };
  } else if (!parsed.iso && display !== raw) parsed = textDate(raw);
  if (!parsed.iso && parsed.precision === 'day') parsed.precision = 'unknown';
  return { raw, ...parsed, display };
}
export function dateBoundary(value: string, end: boolean): string {
  if (value.length === 7) {
    if (!end) return `${value}-01`;
    const [y, m] = value.split('-').map(Number);
    return `${value}-${pad(new Date(Date.UTC(y!, m!, 0)).getUTCDate())}`;
  }
  return value;
}
export function dateInRange(date: DateValue, from?: string, to?: string): { included: boolean; excludedPrecision: boolean } {
  if (!from && !to) return { included: true, excludedPrecision: false };
  if (!date.iso || !['month', 'day'].includes(date.precision)) return { included: false, excludedPrecision: false };
  const low = from ? dateBoundary(from, false) : '0000-01-01';
  const high = to ? dateBoundary(to, true) : '9999-12-31';
  if (date.precision === 'day') return { included: date.iso >= low && date.iso <= high, excludedPrecision: false };
  const first = `${date.iso}-01`, last = dateBoundary(date.iso, true);
  const overlaps = first <= high && last >= low;
  const included = first >= low && last <= high;
  return { included, excludedPrecision: overlaps && !included };
}
