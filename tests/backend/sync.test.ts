import {afterEach,describe,it,expect,vi} from 'vitest';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';import path from 'node:path';
import {createStore} from '../../server/store';import {createSyncService} from '../../server/sync';
import {syntheticWorkbook} from '../domain/fixture';
const dirs:string[]=[];afterEach(async()=>{vi.useRealTimers();await Promise.all(dirs.splice(0).map(p=>rm(p,{recursive:true,force:true})));});
async function store(){await mkdir('.private/test-tmp',{recursive:true});const d=await mkdtemp(path.resolve('.private/test-tmp/sync-'));dirs.push(d);return createStore({directory:d});}
describe('serial synchronization and scheduler',()=>{
 it('keeps last good data when the next schema batch fails and rejects overlapping refresh',async()=>{
   const s=await store();let release!:()=>void;let first=true;
   const service=createSyncService({store:s,allowFixtureForTests:true,loader:async()=>{if(first){first=false;await new Promise<void>(r=>{release=r;});return syntheticWorkbook();}return {...syntheticWorkbook(),sheets:[]};}});
   const pending=service.refresh('admin');await vi.waitFor(()=>expect(release).toBeTypeOf('function'));
   await expect(service.refresh('admin')).rejects.toMatchObject({status:409});release();await pending;
   const id=s.read().snapshot!.id;await expect(service.refresh('admin')).rejects.toMatchObject({status:503});
   expect(s.read().snapshot!.id).toBe(id);expect(s.read().sync).toMatchObject({state:'failed',lastSuccessAt:expect.any(String),lastAttemptAt:expect.any(String)});
   expect(s.read().sync.message).not.toContain('Error:');
 });
 it('actually runs and reschedules at the persisted interval using a fake clock',async()=>{
   const s=await store();vi.useFakeTimers({toFake:['Date','setTimeout','clearTimeout']});vi.setSystemTime('2026-11-09T00:00:00Z');let calls=0;
   const service=createSyncService({store:s,allowFixtureForTests:true,loader:async()=>{calls++;return {...syntheticWorkbook(),fetchedAt:new Date().toISOString()};}});
   await service.start();expect(calls).toBe(1);expect(s.read().sync.nextRunAt).toBe('2026-11-09T00:15:00.000Z');
   await vi.advanceTimersByTimeAsync(15*60000);await service.idle();expect(calls).toBe(2);
   await service.stop();expect(s.read().sync.nextRunAt).toBeNull();
 });
});
