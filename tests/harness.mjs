import { nodeRuntime } from './node-runtime.mjs';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
const digest=s=>createHash('sha256').update(s).digest('hex');
export const PASS='une phrase de passe solide';
export async function setup() {
  const accounts=new Map(),tokens=new Map(),confirmations=new Map(),recoveries=new Map();
  const external={calls:[],groqFailure:false,invalidGroq:false,providerFailure:false};
  const send=(body,status=200)=>Response.json(body,{status});
  const bundle=await build({entryPoints:['worker/worker.js'],bundle:true,write:false,format:'esm'});
  const options={modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-09-28',
    d1Databases:{DB:'test-myplanning'},bindings:{SUPABASE_URL:'https://test.supabase.co',SUPABASE_PUBLISHABLE_KEY:'test-publishable',GROQ_API_KEY:'test-groq-secret'},
    outboundService:async request=>{
      const url=new URL(request.url),body=await request.json();external.calls.push({url:url.href,headers:Object.fromEntries(request.headers),body});
      if(url.hostname==='api.groq.com') {
        if(external.groqFailure)return send({error:{message:'private upstream diagnostics'}},500);
        return send({choices:[{message:{content:external.invalidGroq?'invalid':JSON.stringify({employee_found:'Alice',confidence:95,days:[{day:'monday',shifts:[{start:'09:00',end:'17:00'}]}],warnings:[]})}}]});
      }
      if(url.hostname!=='test.supabase.co')throw new Error('Unexpected network request');
      if(external.providerFailure)return send({msg:'provider private diagnostics'},503);
      if(url.pathname.endsWith('/signup')) {
        let account=accounts.get(body.email);
        if(!account){account={id:randomUUID(),email:body.email,passwordHash:digest(body.password),user_metadata:body.data,email_confirmed_at:null};accounts.set(body.email,account);confirmations.set(body.email,randomUUID().replaceAll('-',''));}
        return send({id:account.id,email:account.email,identities:[{}]});
      }
      if(url.pathname.endsWith('/token')) {
        const account=accounts.get(body.email);
        if(!account||account.passwordHash!==digest(body.password)||!account.email_confirmed_at)return send({msg:'Invalid login credentials'},400);
        const token=randomUUID();tokens.set(token,account);return send({access_token:token,user:account});
      }
      if(url.pathname.endsWith('/recover')) {if(accounts.has(body.email))recoveries.set(body.email,randomUUID().replaceAll('-',''));return send({});}
      if(url.pathname.endsWith('/verify')) {
        const map=body.type==='signup'?confirmations:recoveries;
        const pair=[...map].find(([,value])=>value===body.token_hash);
        if(!pair)return send({msg:'Expired'},400);
        map.delete(pair[0]);const account=accounts.get(pair[0]);account.email_confirmed_at=new Date().toISOString();
        const token=randomUUID();tokens.set(token,account);return send({user:account,access_token:token});
      }
      if(url.pathname.endsWith('/user')) {
        const account=tokens.get(request.headers.get('Authorization')?.slice(7));if(!account)return send({},401);
        account.passwordHash=digest(body.password);return send(account);
      }
      throw new Error('Unexpected auth request');
    }
  };
  const mf=process.env.MYPLANNING_TEST_RUNTIME==='node'?nodeRuntime(options):new Miniflare(convertV4MiniflareOptions(options));
  const db=await mf.getD1Database('DB');
  const schema=await readFile('worker/migrations/0001_accounts.sql','utf8');
  for(const statement of schema.split(';').map(x=>x.trim()).filter(Boolean))await db.prepare(statement).run();
  let ip=0;
  function client(){
    const state={cookie:'',csrf:'',ip:'192.0.2.'+(++ip)};
    state.request=async(path,{method='GET',body,headers={},raw}={})=>{
      const response=await mf.dispatchFetch('https://app.example'+path,{method,headers:{Origin:'https://app.example','CF-Connecting-IP':state.ip,...(state.cookie?{Cookie:state.cookie}:{}),...(state.csrf?{'X-CSRF-Token':state.csrf}:{}),...(body||raw?{'Content-Type':'application/json'}:{}),...headers},body:raw??(body?JSON.stringify(body):undefined)});
      const setCookie=response.headers.get('Set-Cookie');if(setCookie)state.cookie=setCookie.split(';')[0];
      const data=await response.json();if(data.csrfToken)state.csrf=data.csrfToken;
      return {status:response.status,data,headers:response.headers};
    };
    return state;
  }
  async function register(c,handle){
    const mail=handle+'@example.com';
    const result=await c.request('/api/auth/register',{method:'POST',body:{username:handle,email:mail,displayName:handle,password:PASS}});
    if(result.status!==202)throw new Error(JSON.stringify(result));
    return mail;
  }
  async function signUp(c,handle){
    const mail=await register(c,handle);
    await c.request('/api/auth/confirm',{method:'POST',body:{tokenHash:confirmations.get(mail)}});
    const result=await c.request('/api/auth/login',{method:'POST',body:{identifier:handle,password:PASS}});
    if(result.status!==200)throw new Error(JSON.stringify(result));
    return result;
  }
  return {mf,db,client,register,signUp,confirmations,recoveries,accounts,external,close:()=>mf.dispose()};
}
