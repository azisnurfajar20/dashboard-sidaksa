import { readFile } from 'node:fs/promises';
import { describe,it,expect } from 'vitest';
import type { RawWorkbook } from '../../shared/contracts';
import { normalizeWorkbook } from '../../server/domain/normalize';

describe('D1 private REAL workbook regressions (not live integrations)', () => {
  it('reconciles all source counts, exact joins, cached formula findings and date precision', async () => {
    const raw:RawWorkbook=JSON.parse(await readFile(new URL('../../.private/fixtures/source.json',import.meta.url),'utf8'));
    const s=normalizeWorkbook(raw,{referenceTabs:['Crew List Departure','Funnel Rekap']});
    expect(s.counts).toEqual({candidates:409,agents:20,companyRows:78,companyUniqueIds:77,companyMissingNames:2,applications:612,crewRows:128,funnelRows:409});
    expect(s.applications.filter(a=>!a.status.trim())).toHaveLength(238);
    expect(s.applications.filter(a=>a.finalResult==='Lolos')).toHaveLength(181);
    expect(s.applications.filter(a=>a.finalResult==='Tidak Lolos')).toHaveLength(88);
    expect(s.applications.filter(a=>!a.finalResult.trim())).toHaveLength(343);
    expect(s.applications.filter(a=>a.appliedAt.precision==='day')).toHaveLength(349);
    expect(s.applications.filter(a=>a.appliedAt.precision==='month')).toHaveLength(263);
    expect(s.candidates.filter(c=>c.category)).toHaveLength(49);
    expect(s.issues.filter(i=>i.code==='IDENTITY_MISMATCH')).toHaveLength(15);
    expect(s.applications.find(a=>a.source.row===597)).toMatchObject({candidateId:'DKDP_014',identityVerified:false});
    expect(s.companies.filter(c=>c.id==='DCDP_51').map(c=>c.source.row)).toEqual([52,53]);
    expect(s.departures.filter(d=>d.status==='recorded')).toHaveLength(119);
    expect(s.departures.filter(d=>d.status==='month-only')).toHaveLength(2);
    expect(s.departures.filter(d=>d.status==='waiting')).toHaveLength(7);
    expect(s.departures.every(d=>!d.confirmed)).toBe(true);
    expect(s.issues.some(i=>i.code==='FORMULA_SHIFTED_REFERENCE'&&i.source.cell==='B2')).toBe(true);
    expect(s.issues.some(i=>i.code==='FORMULA_RANGE_TRUNCATED'&&i.source.cell==='B2')).toBe(true);
  });
});
