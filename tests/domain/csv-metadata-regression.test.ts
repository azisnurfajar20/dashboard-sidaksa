import { describe, expect, it } from 'vitest';
import { normalizeWorkbook } from '../../server/domain/normalize';
import { csvExport, type ExportKind } from '../../server/domain/query';
import { syntheticWorkbook } from './fixture';

describe('CSV metadata (synthetic workbook, no live transport)', () => {
  it('keeps the fixture source label instead of letting entity SourceRefs overwrite it', () => {
    const snapshot = normalizeWorkbook(syntheticWorkbook(), { referenceTabs: ['Crew List Departure'] });
    for (const kind of ['aggregate', 'applications', 'candidates', 'departures', 'partners'] as ExportKind[]) {
      const csv = csvExport(snapshot, kind, {}, false);
      const [header, ...rows] = csv.trim().split('\r\n');
      expect(header).toContain('"source"');
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) expect(row.split(',')[2], kind).toBe('"fixture"');
      expect(csv, kind).not.toContain('[object Object]');
    }
  });
});
