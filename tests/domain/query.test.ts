import {describe,it,expect} from 'vitest';
import {normalizeWorkbook} from '../../server/domain/normalize';
import {applicationsFor, candidatesFor, departuresFor, overview, dictionaries, partnersFor, csvExport} from '../../server/domain/query';
import {syntheticWorkbook} from './fixture';

describe('cohorts and reporting',()=>{
 it('uses apply cohort, all-time candidate master, empty sentinel and reports precision exclusions',()=>{
   const s=normalizeWorkbook(syntheticWorkbook(),{referenceTabs:['Crew List Departure']});
   expect(applicationsFor(s,{from:'2025-01-02',to:'2025-01-31'})).toMatchObject({rows:[],excludedDatePrecision:1});
   expect(overview(s,{from:'2025-01',to:'2025-01'}).metrics.find(m=>m.key==='applications')!.value).toBe(1);
   expect(overview(s,{from:'2025-02',to:'2025-02'}).metrics.find(m=>m.key==='candidates')!.value).toBe(1);
   expect(applicationsFor(s,{status:'__empty__'}).rows).toHaveLength(0);
   expect(candidatesFor(s,{category:'Program A'})).toHaveLength(1);
   expect(departuresFor(s,{from:'2025-01'}).rows).toHaveLength(0);
   expect(dictionaries(s).candidateCategories).toEqual(['Program A']);
   expect(partnersFor(s,'agents',{}).rows[0]!.passedCount).toBe(1);
 });
 it('reconciles whitespace-only status as blank without changing its raw value',()=>{
   const s=normalizeWorkbook(syntheticWorkbook());
   s.applications[0]!.status=' \t ';
   expect(applicationsFor(s,{status:'__empty__'}).rows).toHaveLength(1);
   expect(overview(s).charts.statuses).toEqual([{label:'Belum diisi',value:1}]);
   expect(s.applications[0]!.status).toBe(' \t ');
 });
 it('keeps KPI drill-down as an intersection with the existing cohort',()=>{
   const s=normalizeWorkbook(syntheticWorkbook());
   s.applications[0]!.status='Closed';
   s.applications.push({...s.applications[0]!,id:'second',status:'In Progress'});
   const metric=overview(s,{status:'Closed'}).metrics.find(m=>m.key==='inProgress')!;
   expect(metric.value).toBe(0);
   expect(applicationsFor(s,metric.filter!).rows).toHaveLength(metric.value!);
   const csv=csvExport(s,'applications',metric.filter!,false);
   expect(csv.split('\r\n').filter(Boolean)).toHaveLength(2);
   expect(csv).toContain('"record_type"');expect(csv).toContain('"metadata","0"');
   expect(csv).not.toContain('"candidateName"');
 });
 it('exports matching rows with explicit unit and snapshot and neutralizes spreadsheet formulas',()=>{
   const raw=syntheticWorkbook(); raw.sheets[3]!.rows[1]!.cells[2]!.value='=HYPERLINK("bad")';
   const s=normalizeWorkbook(raw);
   const csv=csvExport(s,'applications',{},false);
   expect(csv).toContain('snapshot_id');expect(csv).toContain(s.id);
   expect(csv).toContain("'=HYPERLINK");expect(csv).not.toContain('private application notes');
   expect(csvExport(s,'candidates',{},false)).not.toContain('081-PRIVATE');
   expect(csvExport(s,'candidates',{},true)).toContain('081-PRIVATE');
   const empty=csvExport(s,'applications',{from:'2025-02'},false);
   expect(empty.split('\r\n').filter(Boolean)).toHaveLength(2);
   expect(empty).toContain(s.id);expect(empty).toContain('"metadata","0"');
   expect(empty).not.toContain('"candidateName"');
 });
});
