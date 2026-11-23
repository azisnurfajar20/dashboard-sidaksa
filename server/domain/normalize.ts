import { createHash } from 'node:crypto';
import type { Application, Candidate, DataIssue, Departure, MappingDecision, Partner, RawCell, RawRow, RawSheet, RawWorkbook, Snapshot, SourceRef } from '../../shared/contracts.js';
import { parseDate } from './dates.js';

export const REQUIRED_TABS = ['Data Kandidat', 'Data Mitra Agent', 'Data Company', 'Proses Rekrutment'];
export const REFERENCE_TABS = ['Crew List Departure', 'Funnel Rekap'];
export const NORMALIZATION_REVISION = 'be001-verified-attributes-v1';
const schemas: Record<string, string[]> = {
  'Data Kandidat': ['ID_Kandidat','Nama Peserta','Jenis Kelamin','Tahun Lulus','Asal Sekolah','Asal Daerah'],
  'Data Mitra Agent': ['Id_Agent','Nama Agent','Negara','Status'],
  'Data Company': ['Id_Company','Nama Company','Agent','Negara','Hotel/Kapal Pesiar','Status Kerja Sama'],
  'Proses Rekrutment': ['Tanggal Apply','ID Kandidat','Nama Kandidat','Tahun Lulus','Agent','Company','Negara','Basis Kerja','Posisi Dilamar','Tanggal Interview Agent','Interview Agent','Tanggal Interview User','Interview User','Final Result','Status Proses','Tanggal Join'],
  'Crew List Departure': ['Nama','Posisi','Agent','Company','Tanggal Berangkat','Basis Kerja','Tahun Lulus'],
  'Funnel Rekap': ['Id Kandidat','Status Proses','Stage','Agent'],
};
export class SchemaError extends Error { constructor(message: string) { super(message); this.name='SchemaError'; } }
export const text = (c: RawCell | undefined) => c?.value == null ? '' : String(c.value);
const has = (s: string) => Boolean(s.trim());
// Only explicit completed outcomes establish a result-based milestone; pending/exception text stays raw.
const milestoneResult = (s:string) => s==='Lolos'||s==='Tidak Lolos';
const graduation = (s: string) => /^\d{4}$/.test(s.trim()) && +s >= 1900 && +s <= 2200 ? { graduationYear:+s,category:null } : {graduationYear:null,category:s.trim() || null};
interface SheetAccess { sheet: RawSheet; rows: RawRow[]; cell: (row:RawRow,header:string)=>RawCell|undefined; val: (row:RawRow,header:string)=>string; column: (header:string)=>string|undefined }
function columnName(index:number):string|undefined {
  if(index<0)return undefined;
  let name='';for(let n=index+1;n>0;n=Math.floor((n-1)/26))name=String.fromCharCode(65+(n-1)%26)+name;
  return name;
}
function access(book: RawWorkbook, name: string): SheetAccess {
  const sheet=book.sheets.find(s=>s.name===name);
  if (!sheet) throw new SchemaError(`Tab wajib tidak tersedia: ${name}`);
  const header=sheet.rows.find(r=>r.rowNumber===1);
  if (!header) throw new SchemaError(`Header tidak tersedia: ${name}`);
  const columns=header.cells.map(text);
  for (const h of schemas[name] || []) if (columns.filter(c=>c===h).length!==1) throw new SchemaError(`Header wajib hilang/berulang: ${name} / ${h}`);
  const cell=(row:RawRow,h:string)=>row.cells[columns.indexOf(h)];
  return {sheet,rows:sheet.rows.filter(r=>r.rowNumber>1),cell,val:(r,h)=>text(cell(r,h)),column:h=>columnName(columns.indexOf(h))};
}
function exactPartner(value:string, rows:Partner[], mappings:MappingDecision[], kind:'agent'|'company'): string|null {
  const target=mappings.find(m=>m.kind===kind&&m.alias===value)?.targetId;
  const matches=target ? rows.filter(r=>r.id===target) : rows.filter(r=>r.id===value || r.name===value);
  if (matches.length!==1 || rows.filter(r=>r.id===matches[0]!.id).length!==1 || !has(matches[0]!.name)) return null;
  return matches[0]!.id;
}
export interface NormalizeOptions { referenceTabs?: string[]; mappings?: MappingDecision[] }
export function normalizeWorkbook(raw: RawWorkbook, options: NormalizeOptions = {}): Snapshot {
  const refs=options.referenceTabs || [];
  if (refs.some(t=>!REFERENCE_TABS.includes(t))) throw new SchemaError('Tab referensi tidak disetujui');
  if (!Number.isFinite(Date.parse(raw.fetchedAt))) throw new SchemaError('Waktu sumber tidak valid');
  const tabs=Object.fromEntries([...REQUIRED_TABS,...refs].map(name=>[name,access(raw,name)]));
  const hash=createHash('sha256').update(JSON.stringify(raw)).digest('hex');
  const id='s_'+createHash('sha256').update(NORMALIZATION_REVISION+'\n'+hash+JSON.stringify(options)).digest('hex').slice(0,24);
  const candidates:Candidate[]=tabs['Data Kandidat']!.rows.filter(r=>has(tabs['Data Kandidat']!.val(r,'ID_Kandidat'))).map(r=>{
    const v=(h:string)=>tabs['Data Kandidat']!.val(r,h);
    return {id:v('ID_Kandidat'),name:v('Nama Peserta'),gender:v('Jenis Kelamin'),...graduation(v('Tahun Lulus')),school:v('Asal Sekolah'),region:v('Asal Daerah'),phone:v('No. Handphone'),photo:v('Foto'),notes:v('Keterangan'),source:{sheet:'Data Kandidat',row:r.rowNumber},issueCodes:[]};
  });
  function partners(name:string,kind:'agent'|'company'):Partner[] {
    const t=tabs[name]!;
    return t.rows.filter(r=>has(t.val(r,kind==='agent'?'Id_Agent':'Id_Company'))).map(r=>{
      const v=(h:string)=>t.val(r,h);
      return {id:v(kind==='agent'?'Id_Agent':'Id_Company'),name:v(kind==='agent'?'Nama Agent':'Nama Company'),kind,country:v('Negara'),status:v(kind==='agent'?'Status':'Status Kerja Sama'),agent:v('Agent'),contact:v('Contact Person'),address:v('Alamat'),details:v('Detail Informasi'),industry:v('Hotel/Kapal Pesiar'),startedYear:v('Tahun Mulai Kerja Sama'),applicationCount:0,passedCount:0,unknownResultCount:0,source:{sheet:name,row:r.rowNumber},issueCodes:[]};
    });
  }
  const agents=partners('Data Mitra Agent','agent'), companies=partners('Data Company','company');
  const t=tabs['Proses Rekrutment']!;
  const applications:Application[]=t.rows.filter(r=>has(t.val(r,'Nama Kandidat'))).map(r=>{
    const v=(h:string)=>t.val(r,h), d=(h:string)=>parseDate(t.cell(r,h));
    const matches=candidates.filter(c=>c.id===v('ID Kandidat'));
    const candidate=matches.length===1?matches[0]:undefined;
    const identityVerified=!!candidate&&candidate.name.trim()===v('Nama Kandidat').trim();
    const agentInterviewAt=d('Tanggal Interview Agent'),userInterviewAt=d('Tanggal Interview User');
    return {id:`${id}:application:${r.rowNumber}`,candidateId:v('ID Kandidat'),candidateName:v('Nama Kandidat'),identityVerified,candidateGraduationYear:identityVerified?candidate!.graduationYear:null,candidateCategory:identityVerified?candidate!.category:null,agent:v('Agent'),agentId:exactPartner(v('Agent'),agents,options.mappings||[],'agent'),company:v('Company'),companyId:exactPartner(v('Company'),companies,options.mappings||[],'company'),country:v('Negara'),workBase:v('Basis Kerja'),position:v('Posisi Dilamar'),appliedAt:d('Tanggal Apply'),agentInterviewAt,userInterviewAt,joinAt:d('Tanggal Join'),agentInterviewResult:v('Interview Agent'),userInterviewResult:v('Interview User'),finalResult:v('Final Result'),status:v('Status Proses'),stage:milestoneResult(v('Final Result'))?'Seleksi akhir':userInterviewAt.iso||milestoneResult(v('Interview User'))?'Interview user':agentInterviewAt.iso||milestoneResult(v('Interview Agent'))?'Interview agen':d('Tanggal Apply').iso?'Daftar':'Unknown',notes:v('Catatan'),source:{sheet:'Proses Rekrutment',row:r.rowNumber},issueCodes:[]};
  });
  for (const p of [...agents,...companies]) {
    const apps=applications.filter(a=>(p.kind==='agent'?a.agentId:a.companyId)===p.id);
    p.applicationCount=apps.length;p.passedCount=apps.filter(a=>a.finalResult==='Lolos').length;p.unknownResultCount=apps.filter(a=>!has(a.finalResult)).length;
  }
  const issues:DataIssue[]=[];
  function issue(code:string,severity:DataIssue['severity'],message:string,entityType:string,entity:{id:string;source:SourceRef;issueCodes?:string[]},column?:string) {
    if (entity.issueCodes && !entity.issueCodes.includes(code)) entity.issueCodes.push(code);
    issues.push({id:`${id}:issue:${entity.source.sheet}:${entity.source.row}:${code}:${column||''}`,code,severity,message,entityType,entityId:entity.id,source:{...entity.source,...(column?{cell:`${column}${entity.source.row}`}:{})},status:'open'});
  }
  const requiredRows=[
    ['Data Kandidat','ID_Kandidat','MASTER_ID_EMPTY'],['Data Mitra Agent','Id_Agent','MASTER_ID_EMPTY'],['Data Company','Id_Company','MASTER_ID_EMPTY'],
    ['Proses Rekrutment','Nama Kandidat','APPLICATION_NAME_EMPTY'],['Crew List Departure','Nama','CREW_NAME_EMPTY'],['Funnel Rekap','Id Kandidat','FUNNEL_ID_EMPTY'],
  ] as const;
  for(const [name,field,code] of requiredRows) {
    const tab=tabs[name];if(!tab)continue;
    const headers=tab.sheet.rows.find(row=>row.rowNumber===1)!.cells;
    for(const row of tab.rows) {
      const substantive=row.cells.some((cell,index)=>has(text(cell))&&!(name==='Crew List Departure'&&/^no\.?$/i.test(text(headers[index]).trim())));
      if(substantive&&!has(tab.val(row,field)))issue(code,name==='Crew List Departure'||name==='Funnel Rekap'?'warning':'critical','Baris substantif tidak dihitung karena pengenal wajib kosong; tinjau sumber.','rejected-row',{id:`${id}:rejected:${name}:${row.rowNumber}`,source:{sheet:name,row:row.rowNumber}},tab.column(field));
    }
  }
  for (const [entities,type] of [[candidates,'candidate'],[agents,'agent'],[companies,'company']] as const) {
    for (const e of entities) {
      const tab=tabs[e.source.sheet]!,idHeader=type==='candidate'?'ID_Kandidat':type==='agent'?'Id_Agent':'Id_Company',nameHeader=type==='candidate'?'Nama Peserta':type==='agent'?'Nama Agent':'Nama Company';
      if (entities.filter(other=>other.id===e.id).length>1) issue('DUPLICATE_ID','critical','ID master berulang; relasi dikarantina.',type,e,tab.column(idHeader));
      if (!has(e.name)) issue('MASTER_NAME_EMPTY','warning','Nama master belum diisi.',type,e,tab.column(nameHeader));
    }
  }
  for (const c of candidates) if (!has(c.phone||'')) issue('CONTACT_EMPTY','info','Kontak kandidat belum diisi.','candidate',c,tabs['Data Kandidat']!.column('No. Handphone'));
  for (const a of applications) {
    const matched=candidates.filter(c=>c.id===a.candidateId);
    if (!matched.length) issue('CANDIDATE_NOT_FOUND','critical','ID kandidat tidak ditemukan; token sumber dipertahankan.','application',a,t.column('ID Kandidat'));
    else if (!a.identityVerified) issue('IDENTITY_MISMATCH','critical','Nama dan ID kandidat memerlukan pemeriksaan identitas.','application',a,t.column('Nama Kandidat'));
    if (!has(a.status)) issue('STATUS_EMPTY','warning','Status proses belum diisi; tidak dianggap aktif.','application',a,t.column('Status Proses'));
    if (!a.agentId) issue('UNMAPPED_AGENT','warning','Agen belum dapat dipadankan ke master unik.','application',a,t.column('Agent'));
    if (!a.companyId) {
      const matches=companies.filter(c=>c.id===a.company||c.name===a.company);
      issue(matches.length?'AMBIGUOUS_COMPANY':'UNMAPPED_COMPANY','warning','Company belum dapat dipadankan ke master unik.','application',a,t.column('Company'));
    }
    for (const [date,header] of [[a.appliedAt,'Tanggal Apply'],[a.agentInterviewAt,'Tanggal Interview Agent'],[a.userInterviewAt,'Tanggal Interview User'],[a.joinAt,'Tanggal Join']] as const) {
      if (date.precision==='month') issue('DATE_MONTH_ONLY','info','Tanggal hanya memiliki presisi bulan.','application',a,t.column(header));
      if (date.precision==='unknown'||date.precision==='range') issue('DATE_AMBIGUOUS','warning','Teks tanggal dipertahankan; bukan bukti kejadian harian.','application',a,t.column(header));
    }
  }
  const departures:Departure[]=[];
  const crew=tabs['Crew List Departure'];
  if (crew) for (const r of crew.rows.filter(r=>has(crew.val(r,'Nama')))) {
    const date=parseDate(crew.cell(r,'Tanggal Berangkat'));
    const departure:Departure={id:`${id}:crew:${r.rowNumber}`,name:crew.val(r,'Nama'),position:crew.val(r,'Posisi'),agent:crew.val(r,'Agent'),company:crew.val(r,'Company'),date,workBase:crew.val(r,'Basis Kerja'),graduationYear:graduation(crew.val(r,'Tahun Lulus')).graduationYear,status:/menunggu jadwal/i.test(date.raw)?'waiting':date.precision==='month'?'month-only':date.precision==='day'?'recorded':'unknown',confirmed:false,source:{sheet:crew.sheet.name,row:r.rowNumber},issueCodes:[]};
    departures.push(departure);
    issue('CREW_IDENTITY_UNRESOLVED','warning','Referensi nama bukan bukti identitas atau keberangkatan terkonfirmasi.','departure',departure,crew.column('Nama'));
  }
  const funnel=tabs['Funnel Rekap'];
  const funnelRows=funnel?funnel.rows.filter(r=>has(funnel.val(r,'Id Kandidat'))).length:null;
  const lastApplicationRow=Math.max(1,...applications.map(a=>a.source.row));
  for (const ref of refs) for (const r of tabs[ref]!.rows) for (let col=0;col<r.cells.length;col++) {
    const formula=r.cells[col]!.formula;
    if (!formula) continue;
    const column=columnName(col);
    const entity={id:`${id}:reference:${ref}:${r.rowNumber}`,source:{sheet:ref,row:r.rowNumber}};
    if (ref==='Funnel Rekap' && column===tabs[ref]!.column('Status Proses')) {
      const match=formula.match(new RegExp(`\\b\\$?${tabs[ref]!.column('Id Kandidat')}\\$?(\\d+)\\b`,'i'));
      if (match && +match[1]!==r.rowNumber) issue('FORMULA_SHIFTED_REFERENCE','critical','Rumus rekap merujuk ID pada baris berbeda; tidak dipakai untuk KPI.','reference',entity,column);
    }
    if (ref==='Crew List Departure' && /QUERY/i.test(formula)) {
      const match=formula.match(/Proses Rekrutment'?\s*!\s*\$?[A-Z]+\$?2\s*:\s*\$?[A-Z]+\$?(\d+)/i);
      if (match && +match[1]<lastApplicationRow) issue('FORMULA_RANGE_TRUNCATED','critical','Rentang QUERY berhenti sebelum baris substantif lamaran terakhir.','reference',entity,column);
    }
  }
  return {id,normalizationRevision:NORMALIZATION_REVISION,source:raw.source,spreadsheetId:raw.spreadsheetId,createdAt:raw.fetchedAt,fingerprint:raw.fingerprint||hash,candidates,agents,companies,applications,departures,issues,counts:{candidates:candidates.length,applications:applications.length,agents:agents.length,companyRows:companies.length,companyUniqueIds:new Set(companies.map(c=>c.id)).size,companyMissingNames:companies.filter(c=>!has(c.name)).length,crewRows:crew?departures.length:null,funnelRows},referenceStats:{funnelRows,crewRows:crew?departures.length:null,approvedReferenceTabs:[...refs]}};
}
