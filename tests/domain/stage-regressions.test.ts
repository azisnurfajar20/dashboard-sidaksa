import { describe, expect, it } from 'vitest';
import { normalizeWorkbook } from '../../server/domain/normalize';
import { syntheticWorkbook } from './fixture';

const stages = [
  { field: 'Interview Agent', result: 'agentInterviewResult', stage: 'Interview agen' },
  { field: 'Interview User', result: 'userInterviewResult', stage: 'Interview user' },
  { field: 'Final Result', result: 'finalResult', stage: 'Seleksi akhir' },
] as const;

describe('stage evidence (synthetic workbook, not historical events)', () => {
  it.each(stages)('does not treat skipped, pending or arbitrary $field text as a milestone', ({ field, result, stage }) => {
    const raw = syntheticWorkbook();
    const sheet = raw.sheets[3]!;
    const cell = (header: string) => sheet.rows[1]!.cells[sheet.rows[0]!.cells.findIndex(c => c.value === header)]!;
    for (const header of ['Tanggal Interview Agent', 'Interview Agent', 'Tanggal Interview User', 'Interview User', 'Final Result']) cell(header).value = '';
    for (const label of ['Tanpa Interview', 'Pending', 'Menunggu Jadwal', 'Mengundurkan diri', 'Dibatalkan', 'UNRECOGNIZED_LITERAL']) {
      cell(field).value = label;
      const original = structuredClone(raw);
      const application = normalizeWorkbook(raw).applications[0]!;
      expect(application.stage, `${field}: ${label}`).toBe('Daftar');
      expect(application[result]).toBe(label);
      expect(raw).toEqual(original);
    }
    for (const outcome of ['Lolos', 'Tidak Lolos']) {
      cell(field).value = outcome;
      expect(normalizeWorkbook(raw).applications[0]!.stage, outcome).toBe(stage);
    }
    cell(field).value = 'Tanpa Interview';
    cell('Tanggal Apply').value = '';
    expect(normalizeWorkbook(raw).applications[0]!.stage).toBe('Unknown');
    if (field !== 'Final Result') {
      cell(field === 'Interview Agent' ? 'Tanggal Interview Agent' : 'Tanggal Interview User').value = '12 Januari 2025';
      expect(normalizeWorkbook(raw).applications[0]!.stage).toBe(stage);
    }
  });
});
