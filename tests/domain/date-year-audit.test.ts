import { describe, expect, it } from 'vitest';
import { parseDate } from '../../server/domain/dates';
import { normalizeWorkbook } from '../../server/domain/normalize';
import { syntheticWorkbook } from './fixture';

describe('BACKEND005 named month calendar-year validation', () => {
  it.each([1899, 2201, 2300])('rejects %s consistently with numeric months/days and preserves literal text', year => {
    for (const raw of [`Januari ${year}`, `jan-${year}`, `December ${year}`, `01/${year}`, `${year}-01`, `01 Januari ${year}`]) {
      expect(parseDate({ value: raw }), raw).toEqual({ raw, display: raw, iso: null, precision: 'unknown' });
    }
  });
  it.each([1900, 2200])('accepts boundary year %s with month-only precision, never a fabricated day', year => {
    for (const raw of [`Januari ${year}`, `December ${year}`, `01/${year}`, `${year}-01`]) {
      const month = raw.startsWith('December') ? '12' : '01';
      expect(parseDate({ value: raw }), raw).toEqual({ raw, display: raw, iso: `${year}-${month}`, precision: 'month' });
    }
  });
  it('preserves established two-digit year support and quarantines malformed years', () => {
    expect(parseDate({ value: 'Jan 25' })).toMatchObject({ raw: 'Jan 25', iso: '2025-01', precision: 'month' });
    for (const raw of ['Januari 20250', 'Januari 2O25', 'Januari 999']) expect(parseDate({ value: raw })).toEqual({ raw, display: raw, iso: null, precision: 'unknown' });
  });
  it('reports an invalid named month as DATE_AMBIGUOUS rather than DATE_MONTH_ONLY', () => {
    const raw = syntheticWorkbook();
    raw.sheets.find(s => s.name === 'Proses Rekrutment')!.rows[1]!.cells[0] = { value: 'Januari 2300' };
    const snapshot = normalizeWorkbook(raw);
    expect(snapshot.applications[0]!.appliedAt).toMatchObject({ raw: 'Januari 2300', iso: null, precision: 'unknown' });
    expect(snapshot.applications[0]!.issueCodes).toContain('DATE_AMBIGUOUS');
    expect(snapshot.applications[0]!.issueCodes).not.toContain('DATE_MONTH_ONLY');
    expect(snapshot.issues.find(i => i.code === 'DATE_AMBIGUOUS')!.source.cell).toBe('A2');
  });
});
