import {describe,it,expect,vi} from 'vitest';
import {createSupabaseAuthenticator,ApiError} from '../../server/auth';
import {readConfig,publicConfig} from '../../server/config';
describe('Supabase trust boundary',()=>{
 it('verifies tokens via getUser and ignores user-controlled metadata',async()=>{
   const getUser=vi.fn<NonNullable<Parameters<typeof createSupabaseAuthenticator>[1]>['auth']['getUser']>(async(token:string)=>({data:{user:{id:'u1',email:'test@example.invalid',app_metadata:{},user_metadata:{sidaksa_approved:true,sidaksa_role:'admin'}}},error:null}));
   const auth=createSupabaseAuthenticator({url:'https://project.supabase.co',publishableKey:'sb_publishable_fixture'},{auth:{getUser}});
   await expect(auth('unsigned-token')).rejects.toMatchObject({status:403});
   expect(getUser).toHaveBeenCalledWith('unsigned-token');
   getUser.mockResolvedValueOnce({data:{user:{id:'u1',email:'test@example.invalid',app_metadata:{sidaksa_approved:true,sidaksa_role:'leader'},user_metadata:{}}},error:null});
   expect(await auth('signed-token')).toMatchObject({role:'leader',id:'u1'});
 });
 it('fails closed on invalid credentials and offline auth with sanitized errors',async()=>{
   const bad=createSupabaseAuthenticator({url:'https://project.supabase.co',publishableKey:'sb_publishable_fixture'},{auth:{getUser:async()=>({data:{user:null},error:{status:401,message:'PRIVATE'}})}});
   await expect(bad('bad')).rejects.toMatchObject({status:401});
   const offline=createSupabaseAuthenticator({url:'https://project.supabase.co',publishableKey:'sb_publishable_fixture'},{auth:{getUser:async()=>{throw new Error('PRIVATE secret');}}});
   await expect(offline('token')).rejects.toMatchObject({status:503,message:expect.not.stringContaining('PRIVATE')});
   await expect(createSupabaseAuthenticator({url:'',publishableKey:''})('token')).rejects.toBeInstanceOf(ApiError);
 });
 it('publishes only safe browser config and treats blanks as unconfigured',()=>{
   const config=readConfig({});
   expect(publicConfig(config)).toMatchObject({authConfigured:false,supabaseUrl:null,supabasePublishableKey:null});
   expect(config.sheetsConfigured).toBe(false);
   expect(()=>readConfig({SUPABASE_URL:'https://x.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_secret_do-not-expose'})).toThrow(/publishable/);
   expect(()=>readConfig({GOOGLE_REFERENCE_TABS:'["Other"]'})).toThrow();
 });
});
