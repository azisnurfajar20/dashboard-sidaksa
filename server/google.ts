import { createGoogleAuth } from './google-auth.js';
import { z } from 'zod';
import type { RawCell, RawWorkbook } from '../shared/contracts.js';
import type { Config } from './config.js';
import { ApiError } from './auth.js';
import { REQUIRED_TABS, REFERENCE_TABS } from './domain/normalize.js';
export { READ_ONLY_SCOPE } from './google-auth.js';
export type SourceLoader=(referenceTabs:string[])=>Promise<RawWorkbook>;
interface RequestOptions {url:string;method:'GET';timeout:number;retry:false;params?:Record<string,unknown>}
type Requester=(options:RequestOptions)=>Promise<{data:unknown}>;
interface Metadata {properties?:{locale?:string};sheets?:{properties:{title:string;gridProperties:{rowCount:number;columnCount:number}}}[]}
interface Values {valueRanges?:{values?:(string|number|boolean|null)[][]}[]}
const formatCell=z.object({effectiveFormat:z.object({numberFormat:z.object({type:z.string().optional(),pattern:z.string().optional()}).optional()}).optional()});
const formatGrid=z.object({startRow:z.number().int().nonnegative().optional(),startColumn:z.number().int().nonnegative().optional(),rowData:z.array(z.object({values:z.array(formatCell).optional()})).optional()});
const formatResponse=z.object({sheets:z.array(z.object({properties:z.object({title:z.string()}),data:z.array(formatGrid).optional()}))});
const lastColumn:Record<string,string>={'Data Kandidat':'I','Data Mitra Agent':'F','Data Company':'H','Proses Rekrutment':'R','Crew List Departure':'H','Funnel Rekap':'D'};
export function createGoogleSource(config:Config,deps:{request?:Requester;sleep?:(ms:number)=>Promise<void>;now?:()=>Date}={}):SourceLoader {
  let auth:ReturnType<typeof createGoogleAuth>|undefined;
  const sleep=deps.sleep||((ms:number)=>new Promise(resolve=>setTimeout(resolve,ms)));
  const request:Requester=deps.request||(async({params,...options})=>{
    // Initialize only for a configured source; retain a successful client but allow retry after a failed local read.
    auth??=createGoogleAuth(config).catch(error=>{auth=undefined;throw error;});
    const client=await (await auth).getClient(),url=new URL(options.url);
    for(const [key,value] of Object.entries(params||{}))for(const item of Array.isArray(value)?value:[value])if(item!==undefined&&item!==null)url.searchParams.append(key,String(item));
    return client.request({...options,url:url.toString()});
  });
  async function get(url:string,params:Record<string,unknown>):Promise<unknown> {
    for(let attempt=0;;attempt++)try{return (await request({url,method:'GET',timeout:12000,retry:false,params})).data;}catch(error){
      const status=Number((error as {response?:{status?:number}})?.response?.status);
      if(attempt<3&&(status===429||status>=500&&status<600)){await sleep(Math.min(4000,500*2**attempt));continue;}
      throw new ApiError(503,'SOURCE_UNAVAILABLE','Google Sheets tidak dapat dibaca. Snapshot terakhir tetap dipertahankan.');
    }
  }
  return async(referenceTabs)=>{
    if(!config.sheetsConfigured)throw new ApiError(503,'SHEETS_UNCONFIGURED','Google Sheets belum dikonfigurasi.');
    if(referenceTabs.some(t=>!REFERENCE_TABS.includes(t))||new Set(referenceTabs).size!==referenceTabs.length)throw new ApiError(400,'INVALID_REFERENCE','Tab referensi tidak disetujui.');
    const base=`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(config.spreadsheetId)}`;
    const names=[...REQUIRED_TABS,...referenceTabs];
    const metadata=await get(base,{fields:'properties(locale),sheets(properties(title,gridProperties(rowCount,columnCount)))'}) as Metadata;
    const ranges=names.map(name=>{
      const sh=metadata.sheets?.filter(s=>s.properties.title===name);
      if(sh?.length!==1)throw new ApiError(503,'SOURCE_SCHEMA','Tab Google Sheets wajib tidak tersedia.');
      const count=sh[0]!.properties.gridProperties.rowCount;
      if(!Number.isInteger(count)||count<1||count>100000)throw new ApiError(503,'SOURCE_BOUNDS','Ukuran tab melebihi batas pembacaan aman.');
      return `'${name}'!A1:${lastColumn[name]}${count}`;
    });
    const fetchValues=async(selected:string[],render:string)=>(await get(base+'/values:batchGet',{ranges:selected,majorDimension:'ROWS',valueRenderOption:render,dateTimeRenderOption:'SERIAL_NUMBER'})) as Values;
    const raw=await fetchValues(ranges,'UNFORMATTED_VALUE'),formatted=await fetchValues(ranges,'FORMATTED_VALUE');
    if(raw.valueRanges?.length!==names.length||formatted.valueRanges?.length!==names.length)throw new ApiError(503,'SOURCE_INCOMPLETE','Pembacaan Google Sheets tidak lengkap.');
    const formula=referenceTabs.length?await fetchValues(ranges.slice(REQUIRED_TABS.length),'FORMULA'):null;
    if(formula&&formula.valueRanges?.length!==referenceTabs.length)throw new ApiError(503,'SOURCE_INCOMPLETE','Pembacaan rumus referensi tidak lengkap.');
    const formats=formatResponse.safeParse(await get(base,{ranges,fields:'sheets(properties(title),data(startRow,startColumn,rowData(values(effectiveFormat(numberFormat(type,pattern))))))'}));
    if(!formats.success)throw new ApiError(503,'SOURCE_INCOMPLETE','Pembacaan format Google Sheets tidak lengkap.');
    const sheets=names.map((name,index)=>{
      const matches=formats.data.sheets.filter(sheet=>sheet.properties.title===name);
      if(matches.length!==1)throw new ApiError(503,'SOURCE_INCOMPLETE','Pembacaan format Google Sheets tidak lengkap.');
      const patterns=new Map<string,string>();
      const rowBound=metadata.sheets!.find(sheet=>sheet.properties.title===name)!.properties.gridProperties.rowCount,columnBound=lastColumn[name]!.charCodeAt(0)-64;
      for(const grid of matches[0]!.data||[]) {
        const startRow=grid.startRow??0,startColumn=grid.startColumn??0;
        if(startRow>=rowBound||startColumn>=columnBound||startRow+(grid.rowData?.length||0)>rowBound)throw new ApiError(503,'SOURCE_INCOMPLETE','Koordinat format Google Sheets tidak valid.');
        for(const [row,rowData] of (grid.rowData||[]).entries()) {
          if(startColumn+(rowData.values?.length||0)>columnBound)throw new ApiError(503,'SOURCE_INCOMPLETE','Koordinat format Google Sheets tidak valid.');
          for(const [col,cell] of (rowData.values||[]).entries()) {
            const pattern=cell.effectiveFormat?.numberFormat?.pattern;
            if(pattern)patterns.set(`${startRow+row}:${startColumn+col}`,pattern);
          }
        }
      }
      const unformatted=raw.valueRanges![index]!.values||[],display=formatted.valueRanges![index]!.values||[];
      const formulaRows=index>=REQUIRED_TABS.length?formula?.valueRanges?.[index-REQUIRED_TABS.length]?.values||[]:[];
      // Independent Sheets reads are not a transaction: abort changed shape rather than publish partial output.
      if(unformatted.length!==display.length)throw new ApiError(503,'SOURCE_CHANGED','Sumber berubah saat dibaca; sinkronkan kembali.');
      return {name,rows:Array.from({length:unformatted.length},(_,i)=>({rowNumber:i+1,cells:Array.from({length:Math.max(unformatted[i]?.length||0,display[i]?.length||0)},(_,j):RawCell=>{
        const value=unformatted[i]?.[j]??null,shown=String(display[i]?.[j]??'');const f=formulaRows[i]?.[j],numberFormat=patterns.get(`${i}:${j}`);
        return {value,formatted:shown,...(numberFormat?{numberFormat}:{}),...(typeof f==='string'&&f.startsWith('=')?{formula:f}:{} )};
      })}))};
    });
    return {source:'google-sheets',spreadsheetId:config.spreadsheetId,fetchedAt:(deps.now?.()||new Date()).toISOString(),locale:metadata.properties?.locale||'id_ID',sheets};
  };
}
