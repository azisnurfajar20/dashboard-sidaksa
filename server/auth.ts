import {createClient} from '@supabase/supabase-js';
import type {Viewer,Permissions} from '../shared/contracts.js';
export class ApiError extends Error {constructor(public status:number,public code:string,message:string){super(message);this.name='ApiError';}}
export type Authenticator=(token:string)=>Promise<Viewer>;
interface UserClient {auth:{getUser:(token:string)=>Promise<{data:{user:{id:string;email?:string;app_metadata?:Record<string,unknown>;user_metadata?:Record<string,unknown>}|null};error:unknown}>}}
export function permissions(role:Viewer['role']):Permissions{return {viewContact:role!=='leader',manageData:role==='admin',exportDetail:role!=='leader'};}
export function createSupabaseAuthenticator(config:{url:string;publishableKey:string},injectedClient?:UserClient):Authenticator {
 const client=injectedClient||(config.url&&config.publishableKey?createClient(config.url,config.publishableKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:(input,init)=>fetch(input,{...init,signal:AbortSignal.timeout(10000)})}}):null);
 return async(token)=>{
   if(!client)throw new ApiError(503,'AUTH_UNCONFIGURED','Supabase Auth belum dikonfigurasi.');
   let response:Awaited<ReturnType<UserClient['auth']['getUser']>>;
   try{response=await client.auth.getUser(token);}catch{throw new ApiError(503,'AUTH_UNAVAILABLE','Layanan autentikasi tidak tersedia.');}
   if(response.error){const status=Number((response.error as {status?:number}).status);if(status>=500||!status)throw new ApiError(503,'AUTH_UNAVAILABLE','Layanan autentikasi tidak tersedia.');throw new ApiError(401,'INVALID_TOKEN','Sesi tidak valid atau telah kedaluwarsa.');}
   const user=response.data.user;
   if(!user?.id)throw new ApiError(401,'INVALID_TOKEN','Sesi tidak valid atau telah kedaluwarsa.');
   const metadata=user.app_metadata||{};
   const role=metadata.sidaksa_role;
   if(metadata.sidaksa_approved!==true||(role!=='admin'&&role!=='recruiter'&&role!=='leader'))throw new ApiError(403,'ACCOUNT_NOT_APPROVED','Akun belum disetujui untuk SIDAKSA.');
   return {id:user.id,email:user.email||'',role};
 };
}
