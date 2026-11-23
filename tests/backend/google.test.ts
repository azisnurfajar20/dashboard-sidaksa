import {describe,it,expect} from 'vitest';
import {createGoogleSource,READ_ONLY_SCOPE} from '../../server/google';
import {readConfig} from '../../server/config';
import {syntheticWorkbook} from '../domain/fixture';

describe('Google adapter (injected transport, not live access)',()=>{
 it('reads only approved tab ranges with serial and formatted values and bounded retries',async()=>{
   const raw=syntheticWorkbook(),calls:any[]=[],waits:number[]=[];let attempt=0;
   const request=async(o:any)=>{calls.push(o);if(o.url.endsWith('/values:batchGet')){
     if(attempt++===0)throw {response:{status:429},message:'PRIVATE'};
     return {data:{valueRanges:raw.sheets.slice(0,4).map(s=>({values:s.rows.map(r=>r.cells.map(c=>o.params.valueRenderOption==='FORMATTED_VALUE'?c.formatted??String(c.value??''):c.value))}))}};
   }if(o.params?.ranges)return {data:{sheets:raw.sheets.slice(0,4).map(s=>({properties:{title:s.name},data:[{rowData:s.rows.map(r=>({values:r.cells.map(c=>c.numberFormat?{effectiveFormat:{numberFormat:{type:'DATE',pattern:c.numberFormat}}}:{})}))}]}))}};
   return {data:{properties:{locale:'id_ID'},sheets:raw.sheets.map(s=>({properties:{title:s.name,gridProperties:{rowCount:100,columnCount:26}}}))}};};
   const loader=createGoogleSource({...readConfig({}),spreadsheetId:'FIXTURE_GOOGLE_ID',sheetsConfigured:true},{request,sleep:async(ms)=>{waits.push(ms);},now:()=>new Date(raw.fetchedAt)});
   const result=await loader([]);
   expect(result.source).toBe('google-sheets');expect(result.sheets.map(s=>s.name)).toHaveLength(4);
   const reads=calls.filter(c=>c.url.endsWith('/values:batchGet'));
   expect(reads[0].params).toMatchObject({dateTimeRenderOption:'SERIAL_NUMBER',valueRenderOption:'UNFORMATTED_VALUE'});
   expect(reads.at(-1).params.valueRenderOption).toBe('FORMATTED_VALUE');
   expect(reads.every(c=>c.method==='GET'&&c.timeout===12000&&c.retry===false)).toBe(true);
   expect(waits).toHaveLength(1);expect(READ_ONLY_SCOPE).toBe('https://www.googleapis.com/auth/spreadsheets.readonly');
   expect(reads[0].params.ranges.some((r:string)=>r.includes('Crew'))).toBe(false);
 });
 it('does not retry permissions errors and never exposes raw credential errors',async()=>{
   let calls=0;const loader=createGoogleSource({...readConfig({}),sheetsConfigured:true,spreadsheetId:'FIXTURE_GOOGLE_ID'},{request:async()=>{calls++;throw {response:{status:403},message:'-----BEGIN PRIVATE KEY-----\\nFICTITIOUS\\n-----END PRIVATE KEY-----'};}});
   await expect(loader([])).rejects.toMatchObject({status:503,message:expect.not.stringContaining('PRIVATE KEY')});expect(calls).toBe(1);
 });
});
