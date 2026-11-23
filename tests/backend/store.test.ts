import {afterEach,describe,it,expect} from 'vitest';
import {mkdir,mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createStore} from '../../server/store';
import {normalizeWorkbook} from '../../server/domain/normalize';
import {syntheticWorkbook} from '../domain/fixture';

const roots:string[]=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(p=>rm(p,{recursive:true,force:true})));});
export async function privateDir(){const base=path.resolve('.private/test-tmp');await mkdir(base,{recursive:true});const dir=await mkdtemp(path.join(base,'store-'));roots.push(dir);return dir;}
describe('private atomic persistence',()=>{
 it('publishes raw and snapshot atomically and restores a validated real backup',async()=>{
  const dir=await privateDir(),store=await createStore({directory:dir});
  const raw=syntheticWorkbook(),snapshot=normalizeWorkbook(raw,{referenceTabs:[],mappings:[]});
  await store.publish(raw,snapshot);
  const reopened=await createStore({directory:dir});
  expect(reopened.read().snapshot!.id).toBe(snapshot.id);
  const backup=path.join(dir,'backup.json');await reopened.backup(backup);
  await reopened.update(s=>{s.snapshot=null;s.raw=null;});
  await reopened.restore(backup);
  expect(reopened.read().snapshot!.applications).toHaveLength(1);
  const corrupt=JSON.parse(await readFile(backup,'utf8'));corrupt.state.snapshot.applications[0].candidateName='tampered';await writeFile(backup,JSON.stringify(corrupt));
  await expect(reopened.restore(backup)).rejects.toThrow(/valid/i);
  expect(reopened.read().snapshot!.applications[0]!.candidateName).toBe('Test Person');
 });
 it('round-trips valid UTC-offset timestamps without changing source values',async()=>{
   const dir=await privateDir(),store=await createStore({directory:dir});
   const raw={...syntheticWorkbook(),fetchedAt:'2026-11-09T00:00:00+00:00'};
   const snapshot=normalizeWorkbook(raw,{referenceTabs:[],mappings:[]});
   await store.publish(raw,snapshot);
   const reopened=await createStore({directory:dir});
   expect(reopened.read().raw!.fetchedAt).toBe(raw.fetchedAt);
   expect(reopened.read().snapshot!.id).toBe(snapshot.id);
 });
 it('rejects a stale publication after a queued mapping change',async()=>{
   const dir=await privateDir(),store=await createStore({directory:dir});
   const raw=syntheticWorkbook(),snapshot=normalizeWorkbook(raw,{referenceTabs:[],mappings:[]});
   await store.publish(raw,snapshot);
   const mappings=[{id:'m1',kind:'agent' as const,alias:'Reviewed alias',targetId:'AG_1',reason:'Isolated test',createdAt:'2026-11-09T00:00:00Z',createdBy:'test'}];
   const mapped=normalizeWorkbook(raw,{referenceTabs:[],mappings});
   const changed=store.update(s=>{s.mappings=mappings;s.snapshot=mapped;});
   const stale=store.publish(raw,snapshot);
   await changed;
   await expect(stale).rejects.toThrow(/valid/);
   expect((await createStore({directory:dir})).read().snapshot!.id).toBe(mapped.id);
 });
 it('serializes concurrent updates without lost audit entries',async()=>{
   const store=await createStore({directory:await privateDir()});
   await Promise.all(Array.from({length:10},(_,i)=>store.update(s=>{s.audit.push({id:String(i),actorId:'test',at:'2026-11-09T00:00:00Z',action:'test',result:'ok',details:{}});}))); 
   expect((await createStore({directory:store.directory})).read().audit).toHaveLength(10);
 });
});
