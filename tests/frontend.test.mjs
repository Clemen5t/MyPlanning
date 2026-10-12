import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { setup, PASS } from './harness.mjs';

let h,html,code;const windows=[];
before(async()=>{
  h=await setup();html=await readFile('index.html','utf8');
  code=(await readFile('validation.js','utf8')).replaceAll('export ','')+'\n'+(await readFile('auth.js','utf8')).replaceAll('export ','')+'\n'+(await readFile('app.js','utf8')).replace(/^import .*;\r?\n/gm,'');
});
after(async()=>{windows.forEach(w=>w.close());await h?.close();});
async function waitFor(predicate,message='UI did not settle'){
  for(let n=0;n<150;n++){if(predicate())return;await new Promise(r=>setTimeout(r,20));}
  throw new Error(message);
}
async function page(jar={cookie:''},url='https://app.example/'){
  const dom=new JSDOM(html,{url,runScripts:'outside-only'}),w=dom.window;windows.push(w);
  w.AbortController=AbortController;w.TextEncoder=TextEncoder;w.confirm=()=>true;w.URL.createObjectURL=()=> 'blob:test';w.URL.revokeObjectURL=()=>{};
  w.fetch=async(path,options={})=>{
    if(jar.offline)throw new Error('Network offline');
    const response=await h.mf.dispatchFetch(new URL(path,url),{...options,headers:{...options.headers,Origin:new URL(url).origin,'CF-Connecting-IP':'198.51.100.1',...(jar.cookie?{Cookie:jar.cookie}:{})}});
    const set=response.headers.get('Set-Cookie');if(set)jar.cookie=set.split(';')[0];
    return response;
  };
  w.eval(code);return {w,doc:w.document,jar};
}
function fill(p,id,value){const element=p.doc.getElementById(id);assert.ok(element,'Missing input '+id);element.value=value;element.dispatchEvent(new p.w.Event('input',{bubbles:true}));}
function submit(p,id){p.doc.getElementById(id).dispatchEvent(new p.w.Event('submit',{bubbles:true,cancelable:true}));}
async function login(p,identifier,password=PASS){
  await waitFor(()=>p.doc.getElementById('identifier'));fill(p,'identifier',identifier);fill(p,'password',password);submit(p,'authForm');
  await waitFor(()=>p.doc.querySelector('.day')&&!p.doc.getElementById('main').classList.contains('hidden'),'Login failed: '+p.doc.body.textContent);
}

test('UI registration, immediate session, reload, profile, logout and second account isolation',async()=>{
  const p=await page();await waitFor(()=>p.doc.querySelector('[data-mode="register"]'));
  p.doc.querySelector('[data-mode="register"]').click();
  for(const [id,value] of Object.entries({displayName:'Marie',username:'ui-marie',password:PASS,passwordConfirm:PASS}))fill(p,id,value);
  submit(p,'authForm');
  await waitFor(()=>p.doc.querySelector('.day')&&!p.doc.getElementById('main').classList.contains('hidden'));
  assert.equal(p.doc.getElementById('appVersion').textContent,'v0.08');
  assert.ok(!p.doc.body.textContent.includes('Email'));

  p.doc.getElementById('quickAdd').click();fill(p,'noteInput','Planning privé de Marie');p.doc.getElementById('saveEntry').click();
  await waitFor(()=>!p.doc.getElementById('modal').classList.contains('show'));assert.ok(p.doc.getElementById('main').textContent.includes('Planning privé de Marie'));
  assert.equal(p.w.localStorage.length,0);

  const reload=await page(p.jar);await waitFor(()=>reload.doc.querySelector('.day'));assert.ok(reload.doc.getElementById('main').textContent.includes('Planning privé de Marie'));
  reload.doc.querySelector('[data-tab="settings"]').click();fill(reload,'profileName','Marie B');submit(reload,'profileForm');await waitFor(()=>reload.doc.getElementById('profileMessage').textContent==='Profil enregistré.');
  reload.doc.getElementById('logout').click();await waitFor(()=>reload.doc.getElementById('identifier'));
  assert.equal(reload.doc.getElementById('main').textContent,'');assert.equal(reload.doc.getElementById('noteInput').value,'');assert.equal(reload.doc.getElementById('scanPreview').getAttribute('src'),'');

  const c=h.client();await h.signUp(c,'ui-jean');await login(reload,'ui-jean');assert.ok(!reload.doc.body.textContent.includes('Planning privé de Marie'));
});

test('failed saves stay visibly unsaved and retry persists them without localStorage',async()=>{
  const c=h.client();await h.signUp(c,'ui-offline');const p=await page({cookie:c.cookie});await waitFor(()=>p.doc.querySelector('.day'));
  p.doc.getElementById('quickAdd').click();fill(p,'noteInput','À sauvegarder');p.jar.offline=true;p.doc.getElementById('saveEntry').click();
  await waitFor(()=>p.doc.getElementById('syncStatus').textContent.includes('Non enregistré'));
  assert.ok(p.doc.getElementById('modal').classList.contains('show'));assert.equal(p.w.localStorage.length,0);
  p.jar.offline=false;p.doc.getElementById('saveEntry').click();await waitFor(()=>!p.doc.getElementById('modal').classList.contains('show'));
  assert.ok(p.doc.getElementById('main').textContent.includes('À sauvegarder'));
});

test('another device causes a revision conflict rather than overwriting its planning',async()=>{
  const c=h.client();await h.signUp(c,'ui-conflict');const p=await page({cookie:c.cookie});await waitFor(()=>p.doc.querySelector('.day'));
  const data=(await c.request('/api/planning')).data.data;data.settings.employeeLabel='Modification distante';await c.request('/api/planning',{method:'PUT',body:{revision:0,data}});
  p.doc.getElementById('quickAdd').click();p.doc.getElementById('saveEntry').click();await waitFor(()=>p.doc.getElementById('syncStatus').textContent.includes('autre appareil'));
  assert.equal((await c.request('/api/planning')).data.data.settings.employeeLabel,'Modification distante');
});

test('session expiry hides all private content and stops unauthenticated saves',async()=>{
  const c=h.client();const result=await h.signUp(c,'ui-expiry');const p=await page({cookie:c.cookie});await waitFor(()=>p.doc.querySelector('.day'));
  p.doc.getElementById('quickAdd').click();fill(p,'noteInput','Private');
  await h.db.prepare('DELETE FROM sessions WHERE user_id=?').bind(result.data.user.id).run();
  p.doc.getElementById('saveEntry').click();await waitFor(()=>p.doc.getElementById('identifier'));
  assert.equal(p.doc.getElementById('main').textContent,'');assert.equal(p.doc.getElementById('noteInput').value,'');assert.ok(p.doc.querySelector('.nav').classList.contains('hidden'));
});

test('legacy migration is opt-in and removes the local copy only after successful server save',async()=>{
  const c=h.client();await h.signUp(c,'ui-migrate');const p=await page({cookie:c.cookie});await waitFor(()=>p.doc.querySelector('.day'));
  p.w.localStorage.setItem('myplanning:data:v2',JSON.stringify({entries:[{date:'2026-10-12',type:'work',note:'ancienne journée',segments:[{id:'old',start:'08:00',end:'12:00',breakMinutes:0}]}],settings:{employeeLabel:'Ancien planning'}}));
  p.doc.querySelector('[data-tab="settings"]').click();assert.ok(p.doc.getElementById('migrateLocal'));
  assert.equal((await c.request('/api/planning')).data.data.entries.length,0);
  p.doc.getElementById('migrateLocal').click();await waitFor(()=>p.w.localStorage.length===0);
  assert.equal((await c.request('/api/planning')).data.data.entries[0].note,'ancienne journée');
});

test('GitHub Pages shows the migration gateway without making authentication requests',async()=>{
  const count=h.external.calls.length;const p=await page(undefined,'https://clemen5t.github.io/MyPlanning/');
  assert.ok(p.doc.getElementById('exportLegacy'));assert.ok(p.doc.querySelector('a[href="https://myplanning.v76y74m25h.workers.dev/"]'));
  assert.equal(h.external.calls.length,count);assert.equal(p.doc.getElementById('main').textContent,'');
});

test('a photo still being read cannot be sent or displayed after logout',async()=>{
  const c=h.client();await h.signUp(c,'ui-delayed-photo');const p=await page({cookie:c.cookie});await waitFor(()=>p.doc.querySelector('.day'));
  let reader;
  p.w.FileReader=class{constructor(){reader=this;}readAsDataURL(){}};
  p.doc.getElementById('scanPlanning').click();fill(p,'scanName','Alice');
  const upload=p.doc.getElementById('photoGallery');Object.defineProperty(upload,'files',{value:[{type:'image/jpeg'}]});upload.dispatchEvent(new p.w.Event('change'));
  assert.ok(reader);p.doc.getElementById('closeScanner').click();p.doc.querySelector('[data-tab="settings"]').click();p.doc.getElementById('logout').click();await waitFor(()=>p.doc.getElementById('identifier'));
  const before=h.external.calls.length;reader.result='data:image/jpeg;base64,AQID';reader.onload();await new Promise(r=>setTimeout(r,30));
  assert.equal(h.external.calls.length,before);assert.equal(p.doc.getElementById('scanPreview').getAttribute('src'),'');
});


test('iPhone Calendar subscription can be created and revoked from settings',async()=>{
  const c=h.client();await h.signUp(c,'ui-calendar');
  const p=await page({cookie:c.cookie});await waitFor(()=>p.doc.querySelector('.day'));
  p.doc.querySelector('[data-tab="settings"]').click();
  await waitFor(()=>p.doc.getElementById('calendarSyncStatus')?.textContent.includes('non configurée'));
  p.doc.getElementById('calendarSyncCreate').click();
  await waitFor(()=>!p.doc.getElementById('calendarInstall').classList.contains('hidden'));
  const link=p.doc.getElementById('calendarOpen');
  assert.ok(link.getAttribute('href').startsWith('webcal://'));
  assert.ok(p.doc.getElementById('calendarCopy').dataset.url.startsWith('https://app.example/calendar/'));
  p.doc.getElementById('calendarSyncRevoke').click();
  await waitFor(()=>p.doc.getElementById('calendarSyncStatus').textContent.includes('désactivée'));
});
