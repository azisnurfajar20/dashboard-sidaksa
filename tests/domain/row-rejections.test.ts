import { describe, expect, it } from 'vitest';
import { normalizeWorkbook } from '../../server/domain/normalize';
import { syntheticWorkbook } from './fixture';

const cases = [
  { sheet: 'Data Kandidat', field: 'ID_Kandidat', column: 'A', code: 'MASTER_ID_EMPTY', count: 'candidates' },
  { sheet: 'Data Mitra Agent', field: 'Id_Agent', column: 'A', code: 'MASTER_ID_EMPTY', count: 'agents' },
  { sheet: 'Data Company', field: 'Id_Company', column: 'A', code: 'MASTER_ID_EMPTY', count: 'companyRows' },
  { sheet: 'Proses Rekrutment', field: 'Nama Kandidat', column: 'C', code: 'APPLICATION_NAME_EMPTY', count: 'applications' },
  { sheet: 'Crew List Departure', field: 'Nama', column: 'B', code: 'CREW_NAME_EMPTY', count: 'crewRows' },
  { sheet: 'Funnel Rekap', field: 'Id Kandidat', column: 'A', code: 'FUNNEL_ID_EMPTY', count: 'funnelRows' },
] as const;

describe('substantive rejected rows (synthetic workbook)', () => {
  it.each(cases)('keeps an explicit review record for excluded $sheet rows', ({ sheet, field, column, code, count }) => {
    const raw = syntheticWorkbook();
    const tab = raw.sheets.find(s => s.name === sheet)!;
    const missing = structuredClone(tab.rows[1]!);
    missing.rowNumber = 3;
    missing.cells[tab.rows[0]!.cells.findIndex(c => c.value === field)]!.value = '  ';
    tab.rows.push(missing);
    tab.rows.push({ rowNumber: 4, cells: tab.rows[0]!.cells.map(() => ({ value: null, numberFormat: 'mmm-yy' })) });
    if (sheet === 'Crew List Departure') {
      const placeholder = { rowNumber: 5, cells: tab.rows[0]!.cells.map(() => ({ value: null as number | null })) };
      placeholder.cells[0]!.value = 99;
      tab.rows.push(placeholder);
    }
    const original = structuredClone(raw);
    const snapshot = normalizeWorkbook(raw, { referenceTabs: ['Crew List Departure', 'Funnel Rekap'] });
    expect(snapshot.counts[count]).toBe(1);
    const rejected = snapshot.issues.filter(issue => issue.source.sheet === sheet && issue.source.row === 3);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({ code, entityType: 'rejected-row', status: 'open',
      source: { sheet, row: 3, cell: `${column}3` } });
    expect(snapshot.issues.some(issue => issue.source.sheet === sheet && issue.source.row >= 4)).toBe(false);
    expect([...snapshot.candidates, ...snapshot.agents, ...snapshot.companies, ...snapshot.applications, ...snapshot.departures]
      .some(entity => entity.source.sheet === sheet && entity.source.row === 3)).toBe(false);
    expect(raw).toEqual(original);
  });
});
