import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, PASS } from './harness.mjs';
import { defaultPlanning } from '../validation.js';

let h;
before(async()=>{h=await setup();});
after(async()=>{await h?.close();});
const post=(c,path,body)=>c.request('/api/auth/'+path,{method:'POST',body});

test('registration creates a secure session and login works with username only',async()=>{
  const c=h.client();
  const registered=await h.register(c,'alice');
  assert.equal(registered.status,200);
  assert.equal(registered.data.user.username,'alice');
  assert.equal(registered.data.user.email,undefined);
  for(const flag of ['HttpOnly','Secure','SameSite=Lax','Path=/','Max-Age=2592000'])assert.ok(registered.headers.get('set-cookie').includes(flag));

  const restored=h.client();restored.cookie=c.cookie;
  assert.equal((await restored.request('/api/auth/session')).data.user.username,'alice');

  const second=h.client();
  assert.equal((await post(second,'login',{identifier:'ALICE',password:PASS})).status,200);

  const row=await h.db.prepare('SELECT * FROM users WHERE username=?').bind('alice').first();
  assert.ok(row.password_salt);
  assert.ok(row.password_hash);
  assert.notEqual(row.password_hash,PASS);
  assert.equal(row.password_iterations,100000);

  const session=await h.db.prepare('SELECT * FROM sessions LIMIT 1').first();
  assert.notEqual(session.token_hash,c.cookie.split('=')[1]);
});

test('invalid passwords and duplicate usernames are rejected without new accounts',async()=>{
  const c=h.client();
  assert.equal((await post(c,'login',{identifier:'alice',password:'wrong'})).status,401);
  assert.equal((await post(c,'register',{username:'x',displayName:'A',password:'short'})).status,400);
  assert.equal((await post(c,'register',{username:'alice',displayName:'A',password:PASS})).status,409);
  const count=await h.db.prepare('SELECT COUNT(*) AS n FROM users').first();
  assert.equal(count.n,1);
});

test('planning isolation, authenticated ownership, validation and revision conflicts',async()=>{
  const a=h.client(),b=h.client();const ra=await h.signUp(a,'owner-a');await h.signUp(b,'owner-b');
  const data=defaultPlanning();data.entries=[{date:'2026-10-12',type:'work',note:'private Alice',segments:[{id:'" onmouseover="bad',start:'09:00',end:'17:00',breakMinutes:30}]}];
  assert.equal((await a.request('/api/planning',{method:'PUT',body:{revision:0,data}})).status,200);
  assert.equal((await b.request('/api/planning?user_id='+ra.data.user.id)).data.data.entries.length,0);
  assert.equal((await b.request('/api/planning',{method:'PUT',body:{user_id:ra.data.user.id,revision:0,data:defaultPlanning()}})).status,200);
  const saved=await a.request('/api/planning');assert.equal(saved.data.data.entries[0].note,'private Alice');assert.match(saved.data.data.entries[0].segments[0].id,/^[a-f0-9-]+$/);
  assert.equal((await a.request('/api/planning',{method:'PUT',body:{revision:0,data}})).status,409);
  data.entries[0].segments[0].start='<script>';
  assert.equal((await a.request('/api/planning',{method:'PUT',body:{revision:1,data}})).status,400);
  assert.equal((await h.client().request('/api/planning')).status,401);
});

test('CSRF, cross-origin, malformed and oversized bodies are rejected',async()=>{
  const c=h.client();await h.signUp(c,'csrf-user');
  assert.equal((await c.request('/api/planning',{method:'PUT',body:{},headers:{'X-CSRF-Token':''}})).status,403);
  assert.equal((await c.request('/api/auth/logout',{method:'POST',body:{},headers:{Origin:'https://evil.example'}})).status,403);
  assert.equal((await c.request('/api/auth/login',{method:'POST',raw:'{'})).status,400);
  assert.equal((await c.request('/api/auth/login',{method:'POST',raw:'x'.repeat(17000)})).status,413);
  assert.equal((await c.request('/api/auth/login',{method:'POST',raw:'{}',headers:{'Content-Type':'text/plain'}})).status,415);
});

test('logout revokes the cookie server-side and expiry blocks planning and scan',async()=>{
  const c=h.client();await h.signUp(c,'logout-user');const stolen=c.cookie;
  assert.equal((await post(c,'logout',{})).status,200);c.cookie=stolen;
  assert.equal((await c.request('/api/auth/session')).status,401);
  await post(c,'login',{identifier:'logout-user',password:PASS});
  await h.db.prepare('UPDATE sessions SET expires_at=0 WHERE user_id=(SELECT id FROM users WHERE username=?)').bind('logout-user').run();
  assert.equal((await c.request('/api/planning')).status,401);
  assert.equal((await c.request('/scan',{method:'POST',body:{employee:'Alice',image:'AQID'}})).status,401);
});

test('profile edits, password change and logout-all invalidate other devices',async()=>{
  const a=h.client(),b=h.client();await h.signUp(a,'profile-user');await post(b,'login',{identifier:'profile-user',password:PASS});
  assert.equal((await post(a,'profile',{username:'new-profile',displayName:'Nouveau nom'})).data.user.username,'new-profile');
  assert.equal((await post(a,'password',{currentPassword:PASS,password:'nouvelle phrase de passe'})).status,200);
  assert.equal((await b.request('/api/auth/session')).status,401);
  assert.equal((await post(a,'login',{identifier:'new-profile',password:PASS})).status,401);
  assert.equal((await post(a,'login',{identifier:'new-profile',password:'nouvelle phrase de passe'})).status,200);
  await post(b,'login',{identifier:'new-profile',password:'nouvelle phrase de passe'});
  assert.equal((await post(a,'logout-all',{})).status,200);
  assert.equal((await b.request('/api/auth/session')).status,401);
});

test('scanner keeps the Groq contract and secret and requires authentication',async()=>{
  const c=h.client();await h.signUp(c,'scan-user');
  const before=h.external.calls.length;
  assert.equal((await h.client().request('/scan',{method:'POST',body:{employee:'Alice',image:'AQID'}})).status,401);
  assert.equal(h.external.calls.length,before);
  const scanned=await c.request('/scan',{method:'POST',body:{employee:'Alice',image:'data:image/jpeg;base64,AQID'}});
  assert.equal(scanned.status,200);assert.equal(scanned.data.planning.days[0].shifts[0].start,'09:00');
  const sent=h.external.calls.at(-1);assert.equal(sent.headers.authorization,'Bearer test-groq-secret');assert.equal(sent.body.model,'qwen/qwen3.8-27b');
  assert.ok(sent.body.messages[0].content[0].text.includes('UNIQUEMENT le salarié "Alice"'));assert.equal(scanned.headers.get('cache-control'),'no-store');
  h.external.groqFailure=true;const failed=await c.request('/scan',{method:'POST',body:{employee:'Alice',image:'AQID'}});h.external.groqFailure=false;
  assert.equal(failed.status,502);assert.ok(!JSON.stringify(failed.data).includes('private upstream'));
  h.external.invalidGroq=true;assert.equal((await c.request('/scan',{method:'POST',body:{employee:'Alice',image:'AQID'}})).status,502);h.external.invalidGroq=false;
});

test('durable login throttling blocks repeated invalid attempts',async()=>{
  const c=h.client();
  for(let n=0;n<10;n++)assert.equal((await post(c,'login',{identifier:'missing-user',password:PASS})).status,401);
  assert.equal((await post(c,'login',{identifier:'missing-user',password:PASS})).status,429);
});
