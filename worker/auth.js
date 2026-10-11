import { HttpError, json, now, randomToken, hash, readJson, rateLimit, ip } from './security.js';
import { defaultPlanning } from '../validation.js';

const COOKIE='__Host-myplanning';
const MAX_AGE=30*24*60*60;
const PBKDF2_ITERATIONS=100000;
const usernamePattern=/^[a-z0-9][a-z0-9._-]{2,29}$/;

const normalized=value=>typeof value==='string'?value.trim().toLowerCase():'';
function username(value){
  const v=normalized(value);
  if(!usernamePattern.test(v)) throw new HttpError(400,'Identifiant : 3 à 30 lettres, chiffres, points, tirets ou underscores.');
  return v;
}
function password(value){
  if(typeof value!=='string'||[...value].length<12||value.length>128||new TextEncoder().encode(value).length>72)
    throw new HttpError(400,'Mot de passe : au moins 12 caractères et au plus 72 octets.');
  return value;
}
function displayName(value){
  if(typeof value!=='string'||!value.trim()||value.trim().length>80) throw new HttpError(400,'Nom : 1 à 80 caractères.');
  return value.trim();
}
function publicUser(row){return {id:row.id,username:row.username,displayName:row.display_name};}
function cookie(token,age=MAX_AGE){return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`;}
export function clearCookie(){return cookie('',0);}

function bytesToHex(bytes){return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');}
function hexToBytes(hex){
  if(typeof hex!=='string'||hex.length%2) return new Uint8Array();
  const out=new Uint8Array(hex.length/2);
  for(let i=0;i<out.length;i++)out[i]=Number.parseInt(hex.slice(i*2,i*2+2),16);
  return out;
}
function randomSalt(){return bytesToHex(crypto.getRandomValues(new Uint8Array(16)));}
async function derivePasswordHash(pass,saltHex,iterations=PBKDF2_ITERATIONS){
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(pass),'PBKDF2',false,['deriveBits']);
  const bits=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:hexToBytes(saltHex),iterations},key,256);
  return bytesToHex(new Uint8Array(bits));
}
function constantTimeEqual(a,b){
  if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;
  let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;
}
async function verifyPassword(user,pass){
  const salt=user?.password_salt||'00000000000000000000000000000000';
  const iterations=Number(user?.password_iterations)||PBKDF2_ITERATIONS;
  const candidate=await derivePasswordHash(pass,salt,iterations);
  const expected=user?.password_hash||'0'.repeat(64);
  return !!user&&constantTimeEqual(candidate,expected);
}

export async function getSession(request,env){
  const token=request.headers.get('Cookie')?.split(';').map(v=>v.trim()).find(v=>v.startsWith(COOKIE+'='))?.slice(COOKIE.length+1);
  if(!token||!/^[a-f0-9]{64}$/.test(token)) throw new HttpError(401,'Connecte-toi pour accéder à ton planning.');
  const session=await env.DB.prepare(`SELECT users.*,sessions.token_hash,sessions.csrf_token,sessions.expires_at
    FROM sessions JOIN users ON users.id=sessions.user_id WHERE token_hash=? AND expires_at>?`).bind(await hash(token),now()).first();
  if(!session) throw new HttpError(401,'Ta session a expiré. Reconnecte-toi.');
  if(!['GET','HEAD'].includes(request.method)&&request.headers.get('X-CSRF-Token')!==session.csrf_token)
    throw new HttpError(403,'Session invalide. Recharge la page.');
  return session;
}
async function createSession(env,user,request){
  const token=randomToken(),csrf=randomToken(),statements=[
    env.DB.prepare('DELETE FROM sessions WHERE expires_at<=?').bind(now()),
    env.DB.prepare('INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at) VALUES (?,?,?,?)').bind(await hash(token),user.id,csrf,now()+MAX_AGE)
  ];
  const old=request.headers.get('Cookie')?.split(';').map(v=>v.trim()).find(v=>v.startsWith(COOKIE+'='))?.slice(COOKIE.length+1);
  if(old&&/^[a-f0-9]{64}$/.test(old))statements.unshift(env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await hash(old)));
  await env.DB.batch(statements);
  return json({ok:true,user:publicUser(user),csrfToken:csrf},200,{'Set-Cookie':cookie(token)});
}

export async function authRoute(request,env,path){
  if(path==='/api/auth/session'&&request.method==='GET'){
    const s=await getSession(request,env);return json({ok:true,user:publicUser(s),csrfToken:s.csrf_token});
  }
  if(request.method!=='POST')throw new HttpError(405,'Méthode non autorisée.');
  await rateLimit(env,'auth-ip:'+ip(request),30,600);
  const body=await readJson(request);

  if(path==='/api/auth/register'){
    const handle=username(body.username),pass=password(body.password),name=displayName(body.displayName);
    await rateLimit(env,'register:'+ip(request),5,3600);
    const existing=await env.DB.prepare('SELECT id FROM users WHERE username=?').bind(handle).first();
    if(existing)throw new HttpError(409,'Cet identifiant est déjà utilisé.');
    const id=crypto.randomUUID(),salt=randomSalt(),passwordHash=await derivePasswordHash(pass,salt),created=now();
    try{
      await env.DB.batch([
        env.DB.prepare('INSERT INTO users(id,username,display_name,password_salt,password_hash,password_iterations,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)')
          .bind(id,handle,name,salt,passwordHash,PBKDF2_ITERATIONS,created,created),
        env.DB.prepare('INSERT INTO plannings(user_id,data,revision,updated_at) VALUES (?,?,0,?)').bind(id,JSON.stringify(defaultPlanning()),created)
      ]);
    }catch(e){
      if(String(e).toLowerCase().includes('unique'))throw new HttpError(409,'Cet identifiant est déjà utilisé.');
      throw e;
    }
    const user=await env.DB.prepare('SELECT * FROM users WHERE id=?').bind(id).first();
    return createSession(env,user,request);
  }

  if(path==='/api/auth/login'){
    const handle=username(body.identifier);
    if(typeof body.password!=='string'||body.password.length>128)throw new HttpError(400,'Identifiants invalides.');
    await rateLimit(env,'login-id:'+handle,10,600);
    const user=await env.DB.prepare('SELECT * FROM users WHERE username=?').bind(handle).first();
    if(!await verifyPassword(user,body.password))throw new HttpError(401,'Identifiant ou mot de passe incorrect.');
    return createSession(env,user,request);
  }

  const session=await getSession(request,env);

  if(path==='/api/auth/logout'){
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(session.token_hash).run();
    return json({ok:true},200,{'Set-Cookie':clearCookie()});
  }
  if(path==='/api/auth/logout-all'){
    await env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(session.id).run();
    return json({ok:true},200,{'Set-Cookie':clearCookie()});
  }
  if(path==='/api/auth/profile'){
    const handle=username(body.username),name=displayName(body.displayName);
    try{
      await env.DB.prepare('UPDATE users SET username=?,display_name=?,updated_at=? WHERE id=?').bind(handle,name,now(),session.id).run();
    }catch(e){
      if(String(e).toLowerCase().includes('unique'))throw new HttpError(409,'Cet identifiant est déjà utilisé.');
      throw e;
    }
    return json({ok:true,user:publicUser({...session,username:handle,display_name:name})});
  }
  if(path==='/api/auth/password'){
    const next=password(body.password);
    if(typeof body.currentPassword!=='string'||body.currentPassword.length>128)throw new HttpError(400,'Mot de passe actuel requis.');
    const fresh=await env.DB.prepare('SELECT * FROM users WHERE id=?').bind(session.id).first();
    if(!await verifyPassword(fresh,body.currentPassword))throw new HttpError(401,'Mot de passe actuel incorrect.');
    const salt=randomSalt(),passwordHash=await derivePasswordHash(next,salt);
    await env.DB.batch([
      env.DB.prepare('UPDATE users SET password_salt=?,password_hash=?,password_iterations=?,updated_at=? WHERE id=?')
        .bind(salt,passwordHash,PBKDF2_ITERATIONS,now(),session.id),
      env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(session.id)
    ]);
    return json({ok:true,message:'Mot de passe modifié. Reconnecte-toi sur tes appareils.'},200,{'Set-Cookie':clearCookie()});
  }

  throw new HttpError(404,'Route inconnue.');
}
