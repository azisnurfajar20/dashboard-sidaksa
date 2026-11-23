import type { Application, Candidate, DataMeta, Departure, FilterOptions, Metric, OverviewResponse, Partner, QueryFilters, Snapshot, ChartItem } from '../../shared/contracts.js';
import { dateInRange } from './dates.js';

const eq=(value:unknown,filter?:string)=>filter===undefined || (filter==='__empty__'?value==null||typeof value==='string'&&!value.trim():String(value??'')===filter);
const search=(q:string|undefined,values:unknown[])=>!q||values.some(v=>String(v??'').toLocaleLowerCase('id').includes(q.toLocaleLowerCase('id')));
const metricTests:Record<string,(a:Application)=>boolean>={passed:a=>a.finalResult==='Lolos',inProgress:a=>a.status==='In Progress',emptyStatus:a=>!a.status.trim()};
const metricMatch=(a:Application,value?:string)=>!value||value.split(',').every(key=>Object.hasOwn(metricTests,key)&&metricTests[key]!(a));
const metricFilter=(f:QueryFilters,key:string):QueryFilters=>({...f,metric:[...new Set([...(f.metric?f.metric.split(','):[]),key])].join(',')});
function issueMatch(codes:string[],filter?:string) { return !filter || (filter==='true'?codes.length>0:filter==='false'||filter==='__empty__'?codes.length===0:codes.includes(filter)); }
export function meta(s:Snapshot,filters:QueryFilters={},excludedDatePrecision=0):DataMeta {return {snapshotId:s.id,source:s.source,createdAt:s.createdAt,filters,excludedDatePrecision};}
export function applicationsFor(s:Snapshot,f:QueryFilters) {
  let excludedDatePrecision=0;
  const rows=s.applications.filter(a=>{
    if (!metricMatch(a,f.metric)||!search(f.q,[a.id,a.candidateId,a.candidateName,a.agent,a.company,a.position])||!eq(a.agent,f.agent)||!eq(a.company,f.company)||!eq(a.country,f.country)||!eq(a.workBase,f.workBase)||!eq(a.position,f.position)||!eq(a.status,f.status)||!eq(a.finalResult,f.finalResult)||!eq(a.stage,f.stage)||!eq(a.candidateGraduationYear,f.year)||!eq(a.candidateCategory,f.category)||!issueMatch(a.issueCodes,f.issue)) return false;
    const match=dateInRange(a.appliedAt,f.from,f.to);if(match.excludedPrecision)excludedDatePrecision++;return match.included;
  });
  return {rows,excludedDatePrecision};
}
export function candidatesFor(s:Snapshot,f:QueryFilters):Candidate[] { return s.candidates.filter(c=>search(f.q,[c.id,c.name,c.school,c.region])&&eq(c.graduationYear,f.year)&&eq(c.category,f.category)&&issueMatch(c.issueCodes,f.issue)); }
export function departuresFor(s:Snapshot,f:QueryFilters) {
  let excludedDatePrecision=0;
  const rows=s.departures.filter(d=>{
    if (!search(f.q,[d.name,d.agent,d.company,d.position])||!eq(d.agent,f.agent)||!eq(d.company,f.company)||!eq(d.workBase,f.workBase)||!eq(d.position,f.position)||!eq(d.status,f.status)||!eq(d.graduationYear,f.year)||!issueMatch(d.issueCodes,f.issue)) return false;
    const match=dateInRange(d.date,f.from,f.to);if(match.excludedPrecision)excludedDatePrecision++;return match.included;
  });return {rows,excludedDatePrecision};
}
export function partnersFor(s:Snapshot,kind:'agents'|'companies',f:QueryFilters) {
  // Country/issue/search select master rows; all other filters select their linked application cohort.
  const selected=applicationsFor(s,{...f,q:undefined,country:undefined,issue:undefined});
  const masterMatches=(p:Partner)=>search(f.q,[p.id,p.name,p.country])&&eq(p.country,f.country)&&issueMatch(p.issueCodes,f.issue);
  const rows=s[kind].filter(masterMatches).map(p=>{
    const apps=selected.rows.filter(a=>(kind==='agents'?a.agentId:a.companyId)===p.id);
    // Duplicate IDs are intentionally not counted as validated relationships.
    return {...p,applicationCount:apps.length,passedCount:apps.filter(a=>a.finalResult==='Lolos').length,unknownResultCount:apps.filter(a=>!a.finalResult.trim()).length};
  });
  const unresolved=selected.rows.filter(a=>!(kind==='agents'?a.agentId:a.companyId));
  if (unresolved.length) {
    const group:Partner={id:'__unmapped__',name:'Tidak terpetakan',kind:kind==='agents'?'agent':'company',country:'',status:'unresolved',applicationCount:unresolved.length,passedCount:unresolved.filter(a=>a.finalResult==='Lolos').length,unknownResultCount:unresolved.filter(a=>!a.finalResult.trim()).length,source:{sheet:'Proses Rekrutment',row:0},issueCodes:['UNMAPPED_GROUP']};
    if(masterMatches(group)) rows.push(group);
  }
  return {rows,excludedDatePrecision:selected.excludedDatePrecision};
}
function grouped<T>(rows:T[],fn:(row:T)=>string):ChartItem[] {
  const counts=new Map<string,number>();for(const r of rows) {const raw=fn(r),k=raw.trim()?raw:'Belum diisi';counts.set(k,(counts.get(k)||0)+1);}return [...counts].map(([label,value])=>({label,value}));
}
export function overview(s:Snapshot,f:QueryFilters={}):OverviewResponse {
  const selected=applicationsFor(s,f),a=selected.rows;
  const metrics:Metric[]=[
    {key:'candidates',label:'Master kandidat',value:new Set(s.candidates.filter(c=>c.name.trim()&&!c.issueCodes.includes('DUPLICATE_ID')).map(c=>c.id)).size,unit:'kandidat',scope:'all-time',definition:'ID unik dan valid pada seluruh master, bukan seluruh alumni.'},
    {key:'applications',label:'Lamaran',value:a.length,unit:'lamaran',scope:'apply-cohort',definition:'Baris bernama pada snapshot; identitas bermasalah tetap disertakan.',filter:{...f}},
    {key:'passed',label:'Lolos seleksi akhir',value:a.filter(r=>r.finalResult==='Lolos').length,unit:'lamaran',scope:'apply-cohort',definition:'Final Result eksplisit Lolos; bukan bukti bekerja atau berangkat.',filter:metricFilter(f,'passed')},
    {key:'inProgress',label:'Proses In Progress',value:a.filter(r=>r.status==='In Progress').length,unit:'lamaran',scope:'apply-cohort',definition:'Status proses eksplisit In Progress, tidak termasuk kosong.',filter:metricFilter(f,'inProgress')},
    {key:'emptyStatus',label:'Status belum diisi',value:a.filter(r=>!r.status.trim()).length,unit:'lamaran',scope:'apply-cohort',definition:'Status proses kosong, bukan otomatis aktif.',filter:metricFilter(f,'emptyStatus')},
    {key:'crew',label:'Catatan crew',value:s.counts.crewRows,unit:'catatan',scope:'reference',definition:'Seluruh entri roster bernama; bukan orang unik atau keberangkatan terkonfirmasi.'},
  ];
  const ids=new Set(a.map(r=>r.id)); const relevant=s.issues.filter(i=>i.entityType!=='application'||ids.has(i.entityId));
  return {meta:meta(s,f,selected.excludedDatePrecision),metrics,charts:{monthlyApplications:grouped(a,r=>r.appliedAt.iso?.slice(0,7)||'Tidak diketahui').sort((x,y)=>x.label.localeCompare(y.label)),statuses:grouped(a,r=>r.status),results:grouped(a,r=>r.finalResult),workBases:grouped(a,r=>r.workBase),topAgents:grouped(a,r=>r.agentId?r.agent:'Tidak terpetakan').sort((x,y)=>y.value-x.value).slice(0,10)},quality:{issueCount:relevant.length,criticalCount:relevant.filter(i=>i.severity==='critical').length,affectedApplications:a.filter(r=>r.issueCodes.length>0).length}};
}
const unique=(values:(string|number|null)[])=>[...new Set(values.filter(v=>v!==null&&v!=='').map(String))].sort((a,b)=>a.localeCompare(b,'id'));
export function dictionaries(s:Snapshot):FilterOptions { return {agents:unique(s.applications.map(a=>a.agent)),companies:unique(s.applications.map(a=>a.company)),countries:unique(s.applications.map(a=>a.country)),workBases:unique(s.applications.map(a=>a.workBase)),positions:unique(s.applications.map(a=>a.position)),graduationYears:unique(s.candidates.map(c=>c.graduationYear)),candidateCategories:unique(s.candidates.map(c=>c.category)),statuses:unique(s.applications.map(a=>a.status)),finalResults:unique(s.applications.map(a=>a.finalResult)),stages:unique(s.applications.map(a=>a.stage)),issueCodes:unique(s.issues.map(i=>i.code))}; }
export type ExportKind='aggregate'|'applications'|'candidates'|'departures'|'partners';
export function csvCell(value:unknown):string {
  let text=String(value??'');if (/^[\s\u0000-\u001f]*[=+\-@]/.test(text)||/^[\t\r\n]/.test(text)) text="'"+text;
  return '"'+text.replace(/"/g,'""')+'"';
}
export function csvExport(s:Snapshot,kind:ExportKind,f:QueryFilters,contact:boolean,partnerKind:'agents'|'companies'='agents',orderPartners:(rows:Partner[])=>Partner[]=rows=>rows):string {
  const common={snapshot_id:s.id,snapshot_at:s.createdAt,source:s.source,filters:JSON.stringify(f)};
  let rows:Record<string,unknown>[];
  let fields:string[];
  let excludedDatePrecision=0;
  if (kind==='aggregate') {fields=['key','label','value','unit','scope','definition'];rows=overview(s,f).metrics.map(m=>({...m,filter:undefined}));}
  else if(kind==='applications') {fields=['id','candidateId','candidateName','identityVerified','agent','company','country','workBase','position','applied_at','date_precision','finalResult','status','stage','source_sheet','source_row'];if(contact)fields.push('phone');const selected=applicationsFor(s,f);excludedDatePrecision=selected.excludedDatePrecision;rows=selected.rows.map(a=>({...a,applied_at:a.appliedAt.iso,date_precision:a.appliedAt.precision,source_sheet:a.source.sheet,source_row:a.source.row,phone:contact?s.candidates.find(c=>c.id===a.candidateId&&a.identityVerified)?.phone:undefined}));}
  else if(kind==='candidates') {fields=['id','name','gender','graduationYear','category','school','region','source_sheet','source_row'];if(contact)fields.push('phone');rows=candidatesFor(s,f).map(c=>({...c,source_sheet:c.source.sheet,source_row:c.source.row}));}
  else if(kind==='departures') {fields=['id','name','position','agent','company','date','date_precision','status','confirmed','source_sheet','source_row'];const selected=departuresFor(s,f);excludedDatePrecision=selected.excludedDatePrecision;rows=selected.rows.map(d=>({...d,date:d.date.iso,date_precision:d.date.precision,source_sheet:d.source.sheet,source_row:d.source.row}));}
  else {fields=['id','name','kind','country','status','applicationCount','passedCount','unknownResultCount','source_sheet','source_row'];if(contact)fields.push('contact');const selected=partnersFor(s,partnerKind,f);excludedDatePrecision=selected.excludedDatePrecision;rows=orderPartners(selected.rows).map(p=>({...p,source_sheet:p.source.sheet,source_row:p.source.row}));}
  const unit=kind==='applications'?'Satu baris lamaran dalam snapshot':kind==='candidates'?'Satu baris master kandidat':kind==='departures'?'Catatan sumber, bukan konfirmasi keberangkatan':kind==='partners'?'Baris master mitra / kelompok tidak terpetakan':'Definisi KPI per baris';
  // Empty reports use a metadata-only schema: never fabricate an application/partner row.
  const records:Record<string,unknown>[]=rows.length?rows.map(r=>({...r,...common,unit_definition:unit})):[{...common,unit_definition:unit,record_type:'metadata',business_row_count:0,export_kind:kind,partner_kind:kind==='partners'?partnerKind:'',excluded_date_precision:excludedDatePrecision}];
  const columns=rows.length?[...Object.keys(common),'unit_definition',...fields]:Object.keys(records[0]!);
  return '\uFEFF'+[columns.map(csvCell).join(','),...records.map(r=>columns.map(c=>csvCell(r[c])).join(','))].join('\r\n')+'\r\n';
}
