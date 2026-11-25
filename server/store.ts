import { mkdir, readFile, rename, rm, stat, readdir, open, link } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AuditEvent, MappingDecision, RawWorkbook, Snapshot, SyncState } from '../shared/contracts.js';
import { normalizeWorkbook, NORMALIZATION_REVISION, REFERENCE_TABS } from './domain/normalize.js';
import { compatibleSnapshot } from './domain/snapshot-compat.js';
import { ApiError } from './auth.js';

export interface StoredSettings { referenceTabs:string[]; syncIntervalMinutes:number; retentionDays:number }
export interface Review {snapshotId:string;issueId:string;status:'open'|'reviewed'|'resolved';note:string;at:string;by:string}
export interface StoredState { version:1; raw:RawWorkbook|null; snapshot:Snapshot|null; settings:StoredSettings; mappings:MappingDecision[]; reviews:Review[]; audit:AuditEvent[]; sync:SyncState }
/** Existing decisions belong only to the persisted workbook, never to a new configuration. */
export function assertMappingSource(state:Pick<StoredState,'raw'|'mappings'>, source:Pick<RawWorkbook,'source'|'spreadsheetId'>):void {
  if (state.mappings.length && (!state.raw || state.raw.source!==source.source || state.raw.spreadsheetId!==source.spreadsheetId)) {
    throw new ApiError(503,'MAPPING_SOURCE_MISMATCH','Sumber mapping tersimpan berbeda atau tidak dapat diverifikasi. Gunakan penyimpanan privat terpisah untuk sumber ini dan tinjau serta setujui mapping baru secara eksplisit. Mapping lama tetap dipertahankan.');
  }
}
const safeSettings=z.object({referenceTabs:z.array(z.enum(['Crew List Departure','Funnel Rekap'])).max(2),syncIntervalMinutes:z.number().int().min(1).max(1440),retentionDays:z.number().int().min(1).max(365)}).strict();
const cell=z.object({value:z.union([z.string(),z.number().finite(),z.boolean(),z.null()]),formatted:z.string().optional(),formula:z.string().optional(),numberFormat:z.string().optional()}).strict();
export const rawWorkbookSchema=z.object({source:z.enum(['google-sheets','fixture']),spreadsheetId:z.string().min(1).max(200),fetchedAt:z.iso.datetime({offset:true}),fingerprint:z.string().optional(),locale:z.string().optional(),sheets:z.array(z.object({name:z.string(),rows:z.array(z.object({rowNumber:z.number().int().positive(),cells:z.array(cell).max(100)}).strict()).max(100001)}).strict()).max(6)}).strict();
const mapping=z.object({id:z.string(),kind:z.enum(['agent','company']),alias:z.string().min(1).max(200),targetId:z.string().min(1).max(200),reason:z.string().min(1).max(1000),createdAt:z.iso.datetime({offset:true}),createdBy:z.string()}).strict();
const review=z.object({snapshotId:z.string(),issueId:z.string(),status:z.enum(['open','reviewed','resolved']),note:z.string().max(1000),at:z.iso.datetime({offset:true}),by:z.string()}).strict();
const audit=z.object({id:z.string(),at:z.iso.datetime({offset:true}),actorId:z.string(),action:z.string(),result:z.enum(['ok','failed']),details:z.record(z.string(),z.union([z.string(),z.number().finite(),z.boolean(),z.null()]))}).strict();
const sync=z.object({state:z.enum(['never','ok','failed','running']),lastAttemptAt:z.iso.datetime({offset:true}).nullable(),lastSuccessAt:z.iso.datetime({offset:true}).nullable(),nextRunAt:z.iso.datetime({offset:true}).nullable(),message:z.string().nullable()}).strict();
const stateSchema=z.object({version:z.literal(1),raw:rawWorkbookSchema.nullable(),snapshot:z.unknown(),settings:safeSettings,mappings:z.array(mapping),reviews:z.array(review),audit:z.array(audit),sync}).strict();
export function validateStoredState(value:unknown):StoredState {
  try {
  const checked=stateSchema.safeParse(value);if(!checked.success)throw new Error('Data penyimpanan tidak valid');
  const s=checked.data as StoredState;
  if ((s.raw===null)!==(s.snapshot===null)) throw new Error('Pasangan snapshot tidak valid');
  if (s.raw!==null) {
    if (!s.snapshot||typeof s.snapshot!=='object'||Array.isArray(s.snapshot))throw new Error('Snapshot tidak valid');
    const refs=s.snapshot.referenceStats?.approvedReferenceTabs;
    if (!Array.isArray(refs)||refs.some(t=>!REFERENCE_TABS.includes(t)))throw new Error('Referensi snapshot tidak valid');
    s.snapshot=compatibleSnapshot(s.raw,s.snapshot,{referenceTabs:refs,mappings:s.mappings});
  }
  return s;
  } catch {throw new ApiError(503,'STORE_INVALID','Penyimpanan privat tidak valid; pemulihan diperlukan');}
}
export function emptyStoredState(settings?:Partial<StoredSettings>):StoredState {return {version:1,raw:null,snapshot:null,settings:safeSettings.parse({referenceTabs:[],syncIntervalMinutes:15,retentionDays:30,...settings}),mappings:[],reviews:[],audit:[],sync:{state:'never',lastAttemptAt:null,lastSuccessAt:null,nextRunAt:null,message:null}};}
async function atomic(file:string,value:unknown,exclusive=false) {
  await mkdir(path.dirname(file),{recursive:true,mode:0o700});const temp=file+'.'+randomUUID()+'.tmp';
  try {const handle=await open(temp,'wx',0o600);try{await handle.writeFile(JSON.stringify(value));await handle.sync();}finally{await handle.close();}if(exclusive)await link(temp,file);else await rename(temp,file);}finally{await rm(temp,{force:true});}
}
export interface Store {
  directory:string; read:()=>StoredState; revision?:()=>number; update:(fn:(state:StoredState)=>void)=>Promise<void>;
  publish:(raw:RawWorkbook,snapshot:Snapshot,actor?:string)=>Promise<void>;
  backup:(file:string)=>Promise<void>;restore:(file:string)=>Promise<void>;
}
export async function createStore(options:{directory:string;settings?:Partial<StoredSettings>;now?:()=>Date}):Promise<Store> {
  const directory=path.resolve(options.directory),file=path.join(directory,'state.json');await mkdir(directory,{recursive:true,mode:0o700});
  let current:StoredState;
  let legacyBackup:{file:string;state:unknown}|undefined;
  let legacyBackupSaved=false;
  let persisted:string|undefined;
  try {persisted=await readFile(file,'utf8');} catch(error) {if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  if(persisted===undefined)current=emptyStoredState(options.settings);
  else {try {
    const original=JSON.parse(persisted);current=validateStoredState(original);
    if(JSON.stringify(original.snapshot)!==JSON.stringify(current.snapshot))legacyBackup={file:path.join(directory,'compatibility',`state-before-${NORMALIZATION_REVISION}-${randomUUID()}.json`),state:original};
  }catch{throw new ApiError(503,'STORE_INVALID','Penyimpanan privat tidak valid; pemulihan diperlukan');}}
  let revision=0;
  let queue=Promise.resolve();
  const update=(fn:(state:StoredState)=>void|Promise<void>)=>{
    const task=queue.then(async()=>{
      // Load and backup-only CLI calls are read-only. The normal writer's queue owns migration persistence.
      // Back up before invoking a mutator: publish() may also write history inside that callback.
      if(legacyBackup&&!legacyBackupSaved){await atomic(legacyBackup.file,{format:'sidaksa-private-backup',version:1,createdAt:(options.now?.()||new Date()).toISOString(),state:legacyBackup.state},true);legacyBackupSaved=true;}
      const next=structuredClone(current);await fn(next);safeSettings.parse(next.settings);await atomic(file,next);current=next;revision++;legacyBackup=undefined;
    });
    queue=task.catch(()=>{});return task;
  };
  const store:Store={directory,read:()=>structuredClone(current),revision:()=>revision,update,
    async publish(raw,snapshot,actor='scheduler') {
      await update(async s=>{
        assertMappingSource(s,raw);
        const canonical=normalizeWorkbook(raw,{referenceTabs:snapshot.referenceStats.approvedReferenceTabs,mappings:s.mappings});
        if(JSON.stringify(canonical)!==JSON.stringify(snapshot))throw new Error('Snapshot tidak valid');
        // Required archive work shares the queue and mappings; failure cannot follow an active commit.
        await atomic(path.join(directory,'history',snapshot.id+'.json'),{version:1,raw,snapshot,mappings:s.mappings});
        const cutoff=(options.now?.()||new Date()).getTime()-s.settings.retentionDays*86400000;
        const history=path.join(directory,'history');for(const name of await readdir(history)) {if(!/^s_[a-f0-9]+\.json$/.test(name))continue;const p=path.join(history,name);if((await stat(p)).mtimeMs<cutoff)await rm(p,{force:true});}
        s.raw=raw;s.snapshot=snapshot;s.sync={...s.sync,state:'ok',lastSuccessAt:snapshot.createdAt,message:null};
        s.audit.push({id:randomUUID(),at:(options.now?.()||new Date()).toISOString(),actorId:actor,action:'snapshot.publish',result:'ok',details:{snapshotId:snapshot.id,applications:snapshot.counts.applications,source:snapshot.source}});
        s.audit=s.audit.filter(a=>Date.parse(a.at)>=cutoff);s.reviews=s.reviews.filter(r=>Date.parse(r.at)>=cutoff);
      });
    },
    async backup(target) {await queue;validateStoredState(current);await atomic(path.resolve(target),{format:'sidaksa-private-backup',version:1,createdAt:(options.now?.()||new Date()).toISOString(),state:current});},
    async restore(target) {const p=path.resolve(target);if((await stat(p)).size>100*1024*1024)throw new Error('Backup tidak valid');const envelope=JSON.parse(await readFile(p,'utf8'));if(envelope.format!=='sidaksa-private-backup'||envelope.version!==1)throw new Error('Format backup tidak valid');const restored=validateStoredState(envelope.state);await update(s=>{Object.assign(s,restored);s.sync={...s.sync,state:s.snapshot?'ok':'never',nextRunAt:null};s.audit.push({id:randomUUID(),at:(options.now?.()||new Date()).toISOString(),actorId:'cli',action:'backup.restore',result:'ok',details:{snapshotId:s.snapshot?.id||null}});});},
  };return store;
}
