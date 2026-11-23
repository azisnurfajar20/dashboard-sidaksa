import { describe, expect, it } from 'vitest';
import { normalizeWorkbook } from '../../server/domain/normalize';
import { syntheticWorkbook } from './fixture';
import type { RawSheet } from '../../shared/contracts';

const reverseColumns = (sheet: RawSheet) => { for (const row of sheet.rows) row.cells.reverse(); };

describe('validated-header issue tracing (synthetic workbooks)', () => {
  it('traces an unknown literal candidate ID to C2 after swapping the ID and name headers', () => {
    const raw = syntheticWorkbook(), sheet = raw.sheets[3]!;
    sheet.rows[1]!.cells[1]!.value = 'UNKNOWN_LITERAL_ID';
    for (const row of sheet.rows) [row.cells[1], row.cells[2]] = [row.cells[2]!, row.cells[1]!];
    const snapshot = normalizeWorkbook(raw);
    expect(snapshot.applications[0]!.candidateId).toBe('UNKNOWN_LITERAL_ID');
    expect(snapshot.issues.find(issue => issue.code === 'CANDIDATE_NOT_FOUND')!.source)
      .toEqual({ sheet: 'Proses Rekrutment', row: 2, cell: 'C2' });
    expect(sheet.rows[1]!.cells[2]!.value).toBe('UNKNOWN_LITERAL_ID');
  });

  it('traces master, contact, relationship and date issues to their reordered fields', () => {
    const raw = syntheticWorkbook();
    for (const sheet of raw.sheets.slice(0, 3)) {
      sheet.rows.push({ ...structuredClone(sheet.rows[1]!), rowNumber: 3 });
      sheet.rows[1]!.cells[1]!.value = '';
    }
    raw.sheets[0]!.rows[1]!.cells[6]!.value = '';
    const apps = raw.sheets[3]!;
    apps.rows[1]!.cells[14]!.value = '';
    apps.rows[1]!.cells[9]!.value = 'Menunggu Jadwal';
    apps.rows[1]!.cells[11]!.value = 'Februari 2025';
    apps.rows[1]!.cells[15]!.value = 'UNRECOGNIZED_DATE';
    for (const sheet of raw.sheets.slice(0, 4)) reverseColumns(sheet);
    const snapshot = normalizeWorkbook(raw);
    const expected: [string, string, string[]][] = [
      ['Data Kandidat', 'DUPLICATE_ID', ['ID_Kandidat', 'ID_Kandidat']],
      ['Data Kandidat', 'MASTER_NAME_EMPTY', ['Nama Peserta']],
      ['Data Kandidat', 'CONTACT_EMPTY', ['No. Handphone']],
      ['Data Mitra Agent', 'DUPLICATE_ID', ['Id_Agent', 'Id_Agent']],
      ['Data Mitra Agent', 'MASTER_NAME_EMPTY', ['Nama Agent']],
      ['Data Company', 'DUPLICATE_ID', ['Id_Company', 'Id_Company']],
      ['Data Company', 'MASTER_NAME_EMPTY', ['Nama Company']],
      ['Proses Rekrutment', 'IDENTITY_MISMATCH', ['Nama Kandidat']],
      ['Proses Rekrutment', 'STATUS_EMPTY', ['Status Proses']],
      ['Proses Rekrutment', 'UNMAPPED_AGENT', ['Agent']],
      ['Proses Rekrutment', 'AMBIGUOUS_COMPANY', ['Company']],
      ['Proses Rekrutment', 'DATE_MONTH_ONLY', ['Tanggal Apply', 'Tanggal Interview User']],
      ['Proses Rekrutment', 'DATE_AMBIGUOUS', ['Tanggal Interview Agent', 'Tanggal Join']],
    ];
    for (const [name, code, fields] of expected) {
      const sheet = raw.sheets.find(s => s.name === name)!;
      const actual = snapshot.issues.filter(issue => issue.source.sheet === name && issue.code === code);
      expect(actual, `${name}/${code}`).toHaveLength(fields.length);
      const actualFields = actual.map(issue => {
        const column = issue.source.cell!.replace(/\d+$/, '').charCodeAt(0) - 65;
        expect(sheet.rows.some(row => row.rowNumber === issue.source.row)).toBe(true);
        return sheet.rows[0]!.cells[column]!.value;
      });
      expect(actualFields.sort(), `${name}/${code}`).toEqual([...fields].sort());
    }
  });

  it('traces reordered reference formulas and crew identities including AA columns', () => {
    const raw = syntheticWorkbook(), crew = raw.sheets[4]!, funnel = raw.sheets[5]!;
    crew.rows[1]!.cells[1]!.formula = '=QUERY(\'Proses Rekrutment\'!$D$2:$R$1,"select *")';
    for (const row of crew.rows) {
      const name = row.cells[1]!;
      row.cells[1] = { value: null };
      while (row.cells.length < 26) row.cells.push({ value: null });
      row.cells.push(name);
    }
    funnel.rows[1]!.cells[1]!.formula = '=VLOOKUP($D$3,Range,2,0)';
    reverseColumns(funnel);
    const snapshot = normalizeWorkbook(raw, { referenceTabs: ['Crew List Departure', 'Funnel Rekap'] });
    expect(snapshot.issues.find(issue => issue.code === 'CREW_IDENTITY_UNRESOLVED')!.source)
      .toEqual({ sheet: 'Crew List Departure', row: 2, cell: 'AA2' });
    expect(snapshot.issues.find(issue => issue.code === 'FORMULA_RANGE_TRUNCATED')?.source)
      .toEqual({ sheet: 'Crew List Departure', row: 2, cell: 'AA2' });
    expect(snapshot.issues.find(issue => issue.code === 'FORMULA_SHIFTED_REFERENCE')?.source)
      .toEqual({ sheet: 'Funnel Rekap', row: 2, cell: 'C2' });
    funnel.rows[1]!.cells[2]!.formula = '=VLOOKUP($D$2,Range,2,0)';
    expect(normalizeWorkbook(raw, { referenceTabs: ['Crew List Departure', 'Funnel Rekap'] }).issues
      .some(issue => issue.code === 'FORMULA_SHIFTED_REFERENCE')).toBe(false);
  });

  it('does not assign a fictitious cell when the optional contact header is absent', () => {
    const raw = syntheticWorkbook(), sheet = raw.sheets[0]!;
    for (const row of sheet.rows) row.cells.splice(6, 1);
    const issue = normalizeWorkbook(raw).issues.find(issue => issue.code === 'CONTACT_EMPTY')!;
    expect(issue.source).toEqual({ sheet: 'Data Kandidat', row: 2 });
  });
});
