import { describe, expect, it } from 'vitest';
import { createGoogleSource } from '../../server/google';
import { readConfig } from '../../server/config';
import { normalizeWorkbook } from '../../server/domain/normalize';
import { dateInRange } from '../../server/domain/dates';
import { syntheticWorkbook } from '../domain/fixture';

const config = { ...readConfig({}), spreadsheetId: 'SYNTHETIC_GOOGLE_CORE', sheetsConfigured: true };
const formatFields = 'sheets(properties(title),data(startRow,startColumn,rowData(values(effectiveFormat(numberFormat(type,pattern))))))';

// No credentials or network: responses retain Google's actual sheets/data/grid-offset shape.
function transportFixture() {
  const raw = syntheticWorkbook();
  const apply = raw.sheets[3]!.rows[1]!;
  apply.cells[0] = { value: 45658, formatted: '01/25' };
  apply.cells[9] = { value: 45658, formatted: '01/01' };
  const calls: { url: string; method: string; params?: Record<string, unknown> }[] = [];
  const formats = { sheets: raw.sheets.slice(0, 4).reverse().map(sheet => ({
    properties: { title: sheet.name },
    ...(sheet.name === 'Proses Rekrutment' ? { data: [
      { startRow: 1, startColumn: 0, rowData: [{ values: [
        { effectiveFormat: { numberFormat: { type: 'DATE', pattern: 'mm/yy' } } },
        {}, // An omitted/default effective format is a valid sparse cell.
      ] }] },
      { startRow: 1, startColumn: 9, rowData: [{ values: [
        { effectiveFormat: { numberFormat: { type: 'DATE', pattern: 'dd/mm' } } },
        { effectiveFormat: { numberFormat: { type: 'TEXT' } } },
      ] }] },
    ] } : {}),
  })) };
  const request: NonNullable<Parameters<typeof createGoogleSource>[1]>['request'] = async options => {
    calls.push(options);
    if (options.url.endsWith('/values:batchGet')) {
      const selected = options.params!.ranges as string[];
      const sheets = raw.sheets.filter(s => selected.some(range => range.startsWith(`'${s.name}'!`)));
      return { data: { valueRanges: sheets.map(sheet => ({ values: sheet.rows.map(row => row.cells.map(cell =>
        options.params!.valueRenderOption === 'FORMATTED_VALUE' ? cell.formatted ?? String(cell.value ?? '')
          : options.params!.valueRenderOption === 'FORMULA' ? cell.formula ?? cell.value : cell.value)) })) } };
    }
    if (options.params?.ranges) return { data: formats };
    return { data: { properties: { locale: 'id_ID' }, sheets: raw.sheets.map(sheet => ({
      properties: { title: sheet.name, gridProperties: { rowCount: 100, columnCount: 26 } },
    })) } };
  };
  return { raw, calls, formats, request };
}

describe('Google date-format regression (isolated transport)', () => {
  it('retains sparse effective patterns at their actual grid offsets using approved GET ranges', async () => {
    const fixture = transportFixture();
    const book = await createGoogleSource(config, { request: fixture.request })([]);
    expect(book.sheets[3]!.rows[1]!.cells[0])
      .toMatchObject({ value: 45658, formatted: '01/25', numberFormat: 'mm/yy' });
    expect(book.sheets[3]!.rows[1]!.cells[9]!.numberFormat).toBe('dd/mm');
    expect(book.sheets[3]!.rows[1]!.cells[1]!.numberFormat).toBeUndefined();
    expect(book.sheets[3]!.rows[1]!.cells[10]!.numberFormat).toBeUndefined();
    const application = normalizeWorkbook(book).applications[0]!;
    expect(application.appliedAt).toMatchObject({ iso: '2025-01', precision: 'month' });
    expect(application.agentInterviewAt).toMatchObject({ iso: '2025-01-01', precision: 'day' });
    expect(dateInRange(application.appliedAt, '2025-01-01', '2025-01-02'))
      .toEqual({ included: false, excludedPrecision: true });
    const formatRead = fixture.calls.find(call => call.params?.fields === formatFields);
    expect(formatRead?.params?.ranges).toEqual([
      "'Data Kandidat'!A1:I100", "'Data Mitra Agent'!A1:F100",
      "'Data Company'!A1:H100", "'Proses Rekrutment'!A1:R100",
    ]);
    expect(fixture.calls.every(call => call.method === 'GET')).toBe(true);
    expect(fixture.calls.filter(call => call.params?.ranges).every(call =>
      !(call.params!.ranges as string[]).some(range => /Crew List|Funnel Rekap/.test(range)))).toBe(true);
  });

  it.each(['negative-offset', 'out-of-range-column', 'out-of-range-row', 'malformed-pattern', 'malformed-grid'])(
    'rejects incomplete format metadata instead of publishing guessed precision (%s)', async invalid => {
      const fixture = transportFixture();
      const grid = fixture.formats.sheets.find(sheet => sheet.properties.title === 'Proses Rekrutment')!.data![0]!;
      if (invalid === 'negative-offset') grid.startRow = -1;
      if (invalid === 'out-of-range-column') grid.startColumn = 18;
      if (invalid === 'out-of-range-row') grid.startRow = 100;
      if (invalid === 'malformed-pattern') (grid.rowData[0]!.values[0]!.effectiveFormat!.numberFormat as any).pattern = 42;
      if (invalid === 'malformed-grid') (grid as any).rowData = {};
      await expect(createGoogleSource(config, { request: fixture.request })([]))
        .rejects.toMatchObject({ status: 503, code: 'SOURCE_INCOMPLETE' });
    },
  );
});
