import { describe, expect, it } from 'vitest';
import { dateInRange, parseDate } from '../../server/domain/dates';

describe('numeric month display precision (synthetic cells)', () => {
  it('does not invent a day for an unambiguous numeric month and year', () => {
    for (const formatted of ['01/2025', '1-2025', '01.2025', '2025/01', '2025-01']) {
      for (const cell of [{ value: 45658, formatted }, { value: formatted }]) {
        const date = parseDate(cell);
        expect(date, formatted).toMatchObject({ iso: '2025-01', precision: 'month' });
        expect(dateInRange(date, '2025-01-01', '2025-01-02'), formatted)
          .toEqual({ included: false, excludedPrecision: true });
        expect(dateInRange(date, '2025-01', '2025-01'), formatted)
          .toEqual({ included: true, excludedPrecision: false });
      }
    }
  });

  it('requires format evidence before interpreting ambiguous two-number displays', () => {
    for (const formatted of ['01/25', '01-25', '01.25', '1/2', '13/2025']) {
      expect(parseDate({ value: 45658, formatted }), formatted)
        .toMatchObject({ iso: null, precision: 'unknown' });
    }
    expect(parseDate({ value: 45658, formatted: '01/25', numberFormat: 'mm/yy' }))
      .toMatchObject({ iso: '2025-01', precision: 'month' });
    expect(parseDate({ value: 45658, formatted: '01/01', numberFormat: 'dd/mm' }))
      .toMatchObject({ iso: '2025-01-01', precision: 'day' });
  });
});
