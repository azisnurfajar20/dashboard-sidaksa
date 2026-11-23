import { describe, it, expect } from 'vitest';
import { parseDate, dateInRange } from '../../server/domain/dates';

describe('date precision (synthetic unit inputs)', () => {
  it('preserves month precision from text and Excel display format', () => {
    expect(parseDate({ value: 'Januari 2025' })).toMatchObject({ iso: '2025-01', precision: 'month' });
    expect(parseDate({ value: 45658, formatted: 'Jan-25', numberFormat: 'mmm-yy' })).toMatchObject({ iso: '2025-01', precision: 'month' });
    expect(parseDate({ value: '19 September 2025' })).toMatchObject({ iso: '2025-09-19', precision: 'day' });
    expect(parseDate({ value: '12 October 2025' })).toMatchObject({ iso: '2025-10-12', precision: 'day' });
    expect(parseDate({ value: '31/02/2025' }).precision).toBe('unknown');
    expect(parseDate({ value: 'Menunggu Jadwal' }).iso).toBeNull();
    expect(parseDate({ value: '1-3 Mei 2025' }).precision).toBe('range');
    expect(parseDate({ value: null }).precision).toBe('empty');
  });
  it('includes month-only dates only when the complete month is covered', () => {
    const month = parseDate({ value: 'Februari 2024' });
    expect(dateInRange(month, '2024-02-01', '2024-02-29')).toEqual({ included: true, excludedPrecision: false });
    expect(dateInRange(month, '2024-02-02', '2024-02-29')).toEqual({ included: false, excludedPrecision: true });
    expect(dateInRange(month, '2024-03-01', '2024-03-31')).toEqual({ included: false, excludedPrecision: false });
    expect(dateInRange(month, '2024-02', '2024-02').included).toBe(true);
  });
});
