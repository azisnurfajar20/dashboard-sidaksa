import { describe,it,expect } from 'vitest';
import { normalizeWorkbook } from '../../server/domain/normalize';
import { syntheticWorkbook } from './fixture';

describe('normalization (labeled synthetic unit workbook)', () => {
  it('replaces a complete batch, preserves evidence and excludes reference tabs by default', () => {
    const raw=syntheticWorkbook();
    const s=normalizeWorkbook(raw);
    expect(s.counts).toEqual({candidates:1,applications:1,agents:1,companyRows:1,companyUniqueIds:1,companyMissingNames:0,crewRows:null,funnelRows:null});
    expect(s.candidates[0]).toMatchObject({graduationYear:null,category:'Program A',phone:'081-PRIVATE'});
    expect(s.applications[0]).toMatchObject({identityVerified:true,stage:'Seleksi akhir',status:'Completed',candidateId:'DK_001',appliedAt:{iso:'2025-01',precision:'month'}});
    expect(s.applications[0].stage).not.toBe('Berangkat');
    expect(normalizeWorkbook(raw).id).toBe(s.id);
    expect(raw.sheets[3]!.rows[1]!.cells[17]!.value).toBe('Berangkat');
  });
  it('retains invalid identities and ambiguous company rows with source-coordinate issues', () => {
    const raw=syntheticWorkbook();
    const companies=raw.sheets[2]!;
    companies.rows.push({...structuredClone(companies.rows[1]!),rowNumber:3});
    const apps=raw.sheets[3]!;
    apps.rows[1]!.cells[1]!.value='DK_01';
    apps.rows[1]!.cells[14]!.value='';
    const s=normalizeWorkbook(raw);
    expect(s.applications).toHaveLength(1);
    expect(s.applications[0]).toMatchObject({candidateId:'DK_01',identityVerified:false,companyId:null});
    expect(s.issues.map(i=>i.code)).toEqual(expect.arrayContaining(['CANDIDATE_NOT_FOUND','DUPLICATE_ID','STATUS_EMPTY','AMBIGUOUS_COMPANY']));
    expect(s.issues.find(i=>i.code==='CANDIDATE_NOT_FOUND')!.source).toMatchObject({sheet:'Proses Rekrutment',row:2,cell:'B2'});
    expect(() => normalizeWorkbook({...raw,sheets:raw.sheets.slice(1)})).toThrow(/Tab wajib/);
    const broken=syntheticWorkbook();broken.sheets[3]!.rows[0]!.cells[0]!.value='Wrong';
    expect(()=>normalizeWorkbook(broken)).toThrow(/Header wajib/);
  });
  it('audits explicitly approved reference formulas without executing or joining crew by name', () => {
    const raw=syntheticWorkbook();
    raw.sheets[4]!.rows[1]!.cells[1]!.formula='=QUERY(\'Proses Rekrutment\'!$C$2:$Q$1,"select *")';
    const s=normalizeWorkbook(raw,{referenceTabs:['Crew List Departure','Funnel Rekap']});
    expect(s.counts).toMatchObject({crewRows:1,funnelRows:1});
    expect(s.departures[0]).toMatchObject({status:'waiting',confirmed:false,date:{iso:null}});
    expect(s.issues.map(i=>i.code)).toEqual(expect.arrayContaining(['FORMULA_SHIFTED_REFERENCE','FORMULA_RANGE_TRUNCATED','CREW_IDENTITY_UNRESOLVED']));
    expect(s.departures[0]!.id).toContain(s.id);
  });
});
