import { describe, expect, it } from 'vitest';
import { buildQuery, changeFilters, readQuery } from '../../web/lib/query';
import { dateText, sourceLink, wibTime } from '../../web/lib/format';
describe('filter and provenance semantics', () => {
  it('resets pagination on a changed filter without losing empty-value sentinel or exact IDs', () => {
    const next = changeFilters(new URLSearchParams('page=9&agent=DKDP_014&sort=name&direction=desc'), { status: '__empty__' });
    expect(next.get('page')).toBe('1'); expect(next.get('agent')).toBe('DKDP_014'); expect(next.get('status')).toBe('__empty__'); expect(next.get('sort')).toBe('name');
    expect(buildQuery(readQuery(next))).toContain('status=__empty__');
  });
  it('does not invent a first-of-month day or format unknown dates as real dates', () => {
    expect(dateText({ raw: 'Feb 2026', iso: '2026-02', precision: 'month', display: 'Februari 2026' })).toBe('Februari 2026');
    expect(dateText({ raw: 'Menunggu Jadwal', iso: null, precision: 'unknown', display: 'Menunggu Jadwal' })).toBe('Menunggu Jadwal');
    expect(dateText({ raw: '', iso: null, precision: 'empty', display: '' })).toBe('Belum diisi');
  });
  it('uses only a safe supplied spreadsheet ID and exact source coordinate', () => {
    const url = sourceLink('safe_ABC-123', { sheet: 'Proses Rekrutment', row: 597, cell: 'B597' });
    expect(url).toContain('safe_ABC-123'); expect(decodeURIComponent(url!)).toContain("'Proses Rekrutment'!B597");
    expect(sourceLink('javascript:bad', { sheet: 'X', row: 1 })).toBeNull();
    expect(sourceLink('safe', { sheet: 'X', row: -1 })).toBeNull();
  });
  it('labels a real snapshot in WIB rather than the browser timezone', () => { expect(wibTime('2026-11-09T00:00:00.000Z')).toContain('07.00'); expect(wibTime(null)).toBe('Belum tersedia'); });
});
