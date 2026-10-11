import { HttpError, json, now, randomToken, hash, readJson, rateLimit, ip } from './security.js';
import { defaultPlanning } from '../validation.js';

const COOKIE='__Host-myplanning';
const MAX_AGE=30*24*60*60;
const emailPattern=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const usernamePattern=/^[a-z0-9][a-z0-9._-]{2,29}$/;
const normalized = value => typeof value === 'string' ? value.trim().toLowerCase() : '';
function email(value) { const v=normalized(value); if(v.length>254||!emailPattern.test(v)) throw new HttpError(400,'Email invalide.'); return v; }
function username(value) { const v=normalized(value); if(!usernamePattern.test(v)) throw new HttpError(400,'Identifiant : 3 à 30 lettres, chiffres, points, tirets ou underscores.'); return v; }
function password(value) { if(typeof value!=='string'||[...value].length<12||value.length>128||new TextEncoder().encode(value).length>72) throw new HttpError(400,'Mot de passe : au moins 12 caractères et au plus 72 octets (les accents comptent davantage).'); return value; }
function displayName(value) { if(typeof value!=='string'||!value.trim()||value.trim().length>80) throw new HttpError(400,'Nom : 1 à 80 caractères.'); return value.trim(); }
function publicUser(row) { return {id:row.id,email:row.email,username:row.username,displayName:row.display_name}; }
function cookie(token, age=MAX_AGE) { return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`; }
export function clearCookie() { return cookie('',0); }
export async function getSession(request, env) {
  const token=request.headers.get('Cookie')?.split(';').map(v=>v.trim()).find(v=>v.startsWith(COOKIE+'='))?.slice(COOKIE.length+1);
  if(!token||!/^[a-f0-9]{64}$/.test(token)) throw new HttpError(401,'Connecte-toi pour accéder à ton planning.');
  const session=await env.DB.prepare(`SELECT users.*, sessions.token_hash, sessions.csrf_token, sessions.expires_at
    FROM sessions JOIN users ON users.id=sessions.user_id WHERE token_hash=? AND expires_at>?`).bind(await hash(token),now()).first();
  if(!session) throw new HttpError(401,'Ta session a expiré. Reconnecte-toi.');
  if(!['GET','HEAD'].includes(request.method)&&request.headers.get('X-CSRF-Token')!==session.csrf_token) throw new HttpError(403,'Session invalide. Recharge la page.');
  return session;
}
async function createSession(env, user, request) {
  const token=randomToken(), csrf=randomToken();
  const old=request.headers.get('Cookie')?.split(';').map(v=>v.trim()).find(v=>v.startsWith(COOKIE+'='))?.slice(COOKIE.length+1)||'';
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE token_hash=? OR expires_at<=?').bind(await hash(old),now()),
    env.DB.prepare('INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at) VALUES (?,?,?,?)').bind(await hash(token),user.id,csrf,now()+MAX_AGE)
  ]);
  return json({ok:true,user:publicUser(user),csrfToken:csrf},200,{'Set-Cookie':cookie(token)});
}

// The publishable (or legacy anon) key is sufficient. Never use service_role.
async function provider(env, path, body, token, method='POST') {
  if(!env.SUPABASE_URL||!env.SUPABASE_PUBLISHABLE_KEY) throw new HttpError(503,'La connexion n’est pas encore configurée.');
  const base=new URL(env.SUPABASE_URL);
  if(base.protocol!=='https:' || !base.hostname.endsWith('.supabase.co')) throw new HttpError(503,'Configuration de connexion invalide.');
  let response;
  try {
    response=await fetch(new URL('/auth/v1/'+path,base),{method,headers:{apikey:env.SUPABASE_PUBLISHABLE_KEY,'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
  } catch { throw new HttpError(503,'Service de connexion indisponible. Réessaie.'); }
  const data=await response.json().catch(()=>({}));
  if(!response.ok) {
    if(response.status===429) throw new HttpError(429,'Trop de tentatives. Réessaie plus tard.');
    if(response.status>=500) throw new HttpError(503,'Service de connexion indisponible. Réessaie.');
    throw new HttpError(400,'Identifiants ou lien invalides. Vérifie aussi la confirmation de ton email.');
  }
  return data;
}
async function loginProvider(env, mail, pass) {
  const result=await provider(env,'token?grant_type=password',{email:mail,password:pass});
  if(!result.user?.id||!result.user.email_confirmed_at||normalized(result.user.email)!==mail) throw new HttpError(401,'Confirme ton email avant de te connecter.');
  return result;
}
async function ensureUser(env, verified) {
  let user=await env.DB.prepare('SELECT * FROM users WHERE id=?').bind(verified.id).first();
  if(user) return user;
  const mail=email(verified.email);
  const reservation=await env.DB.prepare('SELECT username FROM reservations WHERE email=? AND expires_at>?').bind(mail,now()).first();
  let handle=reservation?.username || normalized(verified.user_metadata?.username);
  if(!usernamePattern.test(handle)) handle='user-'+verified.id.replace(/-/g,'').slice(0,20);
  if(await env.DB.prepare('SELECT id FROM users WHERE username=?').bind(handle).first()) handle='user-'+verified.id.replace(/-/g,'').slice(0,20);
  const name=String(verified.user_metadata?.display_name||handle).slice(0,80);
  await env.DB.batch([
    env.DB.prepare('INSERT OR IGNORE INTO users(id,email,username,display_name,created_at) VALUES (?,?,?,?,?)').bind(verified.id,mail,handle,name,now()),
    env.DB.prepare('INSERT OR IGNORE INTO plannings(user_id,data,revision,updated_at) VALUES (?,?,0,?)').bind(verified.id,JSON.stringify(defaultPlanning()),now()),
    env.DB.prepare('DELETE FROM reservations WHERE email=?').bind(mail)
  ]);
  user=await env.DB.prepare('SELECT * FROM users WHERE id=?').bind(verified.id).first();
  if(!user) throw new HttpError(409,'Ce compte nécessite une vérification par le support.');
  return user;
}
export async function authRoute(request, env, path) {
  if(path==='/api/auth/session'&&request.method==='GET') {
    const s=await getSession(request,env); return json({ok:true,user:publicUser(s),csrfToken:s.csrf_token});
  }
  if(request.method!=='POST') throw new HttpError(405,'Méthode non autorisée.');
  await rateLimit(env,'auth-ip:'+ip(request),30,600);
  const body=await readJson(request);
  if(path==='/api/auth/register') {
    const mail=email(body.email), handle=username(body.username), pass=password(body.password), name=displayName(body.displayName);
    await rateLimit(env,'register:'+ip(request),5,3600);
    await env.DB.prepare('DELETE FROM reservations WHERE expires_at<=?').bind(now()).run();
    const occupied=await env.DB.prepare('SELECT email FROM users WHERE username=? UNION ALL SELECT email FROM reservations WHERE username=?').bind(handle,handle).first();
    if(occupied && occupied.email!==mail) throw new HttpError(409,'Cet identifiant est indisponible.');
    const result=await provider(env,'signup',{email:mail,password:pass,data:{username:handle,display_name:name}});
    // Reservations only aid username login; they NEVER authorize a session.
    if(result.id || result.user?.id) await env.DB.prepare('INSERT OR IGNORE INTO reservations(username,email,expires_at) VALUES (?,?,?)').bind(handle,mail,now()+86400).run();
    return json({ok:true,message:'Si l’inscription est possible, un email de confirmation arrive. Confirme-le, puis connecte-toi. En cas de doute, utilise ton email.'},202);
  }
  if(path==='/api/auth/login') {
    const identifier=normalized(body.identifier);
    if(!identifier||identifier.length>254||typeof body.password!=='string'||body.password.length>128) throw new HttpError(400,'Identifiants invalides.');
    await rateLimit(env,'login-id:'+identifier,10,600);
    let mail=identifier;
    if(!emailPattern.test(mail)) {
      const row=await env.DB.prepare('SELECT email FROM users WHERE username=? UNION ALL SELECT email FROM reservations WHERE username=? AND expires_at>?').bind(identifier,identifier,now()).first();
      // Still contact the provider to avoid a distinct fast unknown-user path.
      mail=row?.email || 'unknown-'+(await hash(identifier)).slice(0,20)+'@invalid.example';
    }
    let result;
    try { result=await loginProvider(env,mail,body.password); }
    catch(error) { if(error.status===400||error.status===401) throw new HttpError(401,'Identifiants invalides ou email non confirmé.'); throw error; }
    return createSession(env,await ensureUser(env,result.user),request);
  }
  if(path==='/api/auth/forgot-password') {
    const mail=email(body.email);
    await rateLimit(env,'recovery:'+mail,3,3600);
    await provider(env,'recover',{email:mail});
    return json({ok:true,message:'Si ce compte existe, un email de réinitialisation a été envoyé.'});
  }
  if(path==='/api/auth/confirm') {
    if(typeof body.tokenHash!=='string'||!/^[a-zA-Z0-9_-]{20,256}$/.test(body.tokenHash)) throw new HttpError(400,'Lien invalide.');
    await provider(env,'verify',{token_hash:body.tokenHash,type:'signup'});
    return json({ok:true,message:'Email confirmé. Tu peux te connecter.'});
  }
  if(path==='/api/auth/reset-password') {
    const pass=password(body.password);
    if(typeof body.tokenHash!=='string'||!/^[a-zA-Z0-9_-]{20,256}$/.test(body.tokenHash)) throw new HttpError(400,'Lien invalide.');
    const result=await provider(env,'verify',{token_hash:body.tokenHash,type:'recovery'});
    if(!result.access_token||!result.user?.id) throw new HttpError(400,'Lien expiré. Demande un nouvel email.');
    // Revoke first: even if provider update fails, no old app session survives recovery.
    await env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(result.user.id).run();
    await provider(env,'user',{password:pass},result.access_token,'PUT');
    return json({ok:true,message:'Mot de passe modifié. Reconnecte-toi.'},200,{'Set-Cookie':clearCookie()});
  }
  const session=await getSession(request,env);
  if(path==='/api/auth/logout') {
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(session.token_hash).run();
    return json({ok:true},200,{'Set-Cookie':clearCookie()});
  }
  if(path==='/api/auth/logout-all') {
    await env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(session.id).run();
    return json({ok:true},200,{'Set-Cookie':clearCookie()});
  }
  if(path==='/api/auth/profile') {
    const handle=username(body.username), name=displayName(body.displayName);
    const reservation=await env.DB.prepare('SELECT email FROM reservations WHERE username=? AND expires_at>?').bind(handle,now()).first();
    if(reservation&&reservation.email!==session.email) throw new HttpError(409,'Cet identifiant est indisponible.');
    try { await env.DB.prepare('UPDATE users SET username=?,display_name=? WHERE id=?').bind(handle,name,session.id).run(); }
    catch(e) { if(String(e).includes('UNIQUE')) throw new HttpError(409,'Cet identifiant est indisponible.'); throw e; }
    return json({ok:true,user:publicUser({...session,username:handle,display_name:name})});
  }
  if(path==='/api/auth/password') {
    const pass=password(body.password);
    if(typeof body.currentPassword!=='string'||body.currentPassword.length>128) throw new HttpError(400,'Mot de passe actuel requis.');
    const result=await loginProvider(env,session.email,body.currentPassword);
    if(result.user.id!==session.id) throw new HttpError(403,'Compte invalide.');
    await env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(session.id).run();
    await provider(env,'user',{password:pass,current_password:body.currentPassword},result.access_token,'PUT');
    return json({ok:true,message:'Mot de passe modifié. Reconnecte-toi sur tes appareils.'},200,{'Set-Cookie':clearCookie()});
  }
  throw new HttpError(404,'Route inconnue.');
}
