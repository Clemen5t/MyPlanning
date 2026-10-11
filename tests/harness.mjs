import { nodeRuntime } from './node-runtime.mjs';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFile } from 'node:fs/promises';

export const PASS='une phrase de passe solide';

export async function setup(){
  const external={calls:[],groqFailure:false,invalidGroq:false};
  const send=(body,status=200)=>Response.json(body,{status});
  const bundle=await build({entryPoints:['worker/worker.js'],bundle:true,write:false,format:'esm'});
  const options={
    modules:true,
    script:bundle.outputFiles[0].text,
    compatibilityDate:'2026-09-28',
    d1Databases:{DB:'test-myplanning'},
    bindings:{GROQ_API_KEY:'test-groq-secret'},
    outboundService:async request=>{
      const url=new URL(request.url),body=await request.json();
      external.calls.push({url:url.href,headers:Object.fromEntries(request.headers),body});
      if(url.hostname!=='api.groq.com')throw new Error('Unexpected network request');
      if(external.groqFailure)return send({error:{message:'private upstream diagnostics'}},500);
      return send({choices:[{message:{content:external.invalidGroq?'invalid':JSON.stringify({employee_found:'Alice',confidence:95,days:[{day:'monday',shifts:[{start:'09:00',end:'17:00'}]}],warnings:[]})}}]});
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
      const response=await mf.dispatchFetch('https://app.example'+path,{
        method,
        headers:{Origin:'https://app.example','CF-Connecting-IP':state.ip,...(state.cookie?{Cookie:state.cookie}:{}),...(state.csrf?{'X-CSRF-Token':state.csrf}:{}),...(body||raw?{'Content-Type':'application/json'}:{}),...headers},
        body:raw??(body?JSON.stringify(body):undefined)
      });
      const setCookie=response.headers.get('Set-Cookie');if(setCookie)state.cookie=setCookie.split(';')[0];
      const data=await response.json();if(data.csrfToken)state.csrf=data.csrfToken;
      return {status:response.status,data,headers:response.headers};
    };
    return state;
  }
  async function register(c,handle){
    const result=await c.request('/api/auth/register',{method:'POST',body:{username:handle,displayName:handle,password:PASS}});
    if(result.status!==200)throw new Error(JSON.stringify(result));
    return result;
  }
  async function signUp(c,handle){return register(c,handle);}
  return {mf,db,client,register,signUp,external,close:()=>mf.dispose()};
}
