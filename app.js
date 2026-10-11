import { AuthUI } from './auth.js';
import { defaultPlanning, validatePlanning } from './validation.js';

(function(){
'use strict';
var KEY='myplanning:data:v2';
var state={tab:'week',anchor:new Date(),data:defaultPlanning(),editing:null};
var auth, revision=0, dirty=false, saving=null;
var typeLabels={work:'Travail',rest:'Repos',leave:'Congé',sick:'Arrêt',training:'Formation'};
var days=['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'];
var daysLong=['lundi','mardi','mercredi','jeudi','vendredi','samedi','dimanche'];
var months=['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];

function defaults(){return defaultPlanning()}
function clearPrivateState(){
  state.data=defaults();state.editing=null;state.tab='week';revision=0;dirty=false;
  document.getElementById('main').replaceChildren();document.getElementById('main').classList.add('hidden');
  document.querySelector('.nav').classList.add('hidden');document.getElementById('headerTarget').textContent='Mon compte';
  document.getElementById('modal').classList.remove('show');document.getElementById('segmentsWrap').replaceChildren();
  document.getElementById('noteInput').value='';document.getElementById('scanName').value='';closeScanner();resetScan();
  document.getElementById('syncStatus').classList.add('hidden');
}
function syncMessage(message,error){
  var box=document.getElementById('syncStatus');box.classList.remove('hidden');box.classList.toggle('sync-error',!!error);box.replaceChildren();
  var text=document.createElement('span');text.textContent=message;box.appendChild(text);
  if(error&&auth.user){
    [['Réessayer',function(){persist().then(function(ok){if(ok)render()})}],['Exporter mes modifications',exportJson],['Recharger le planning',async function(){
      if(dirty&&!confirm('Abandonner les modifications non enregistrées et recharger le planning du compte ?'))return;
      try{await loadAccount();}catch(e){syncMessage(e.message,true)}
    }]].forEach(function(item){var b=document.createElement('button');b.className='btn';b.textContent=item[0];b.onclick=item[1];box.appendChild(b)});
  }
}
async function loadAccount(){
  var result=await auth.api('/api/planning');state.data=validatePlanning(result.data);revision=result.revision;dirty=false;
  document.getElementById('main').classList.remove('hidden');document.querySelector('.nav').classList.remove('hidden');
  render();syncMessage('Planning enregistré dans ton compte.',false);
}
async function persist(){
  dirty=true;if(saving)return saving;
  if(!auth.user)return false;
  var epoch=auth.epoch;
  saving=(async function(){
    var buttons=Array.from(document.querySelectorAll('button,input,textarea,select')).filter(function(b){return !b.disabled});buttons.forEach(function(b){b.disabled=true});
    try{
      var snapshot=validatePlanning(state.data);syncMessage('Enregistrement…',false);
      var result=await auth.api('/api/planning',{method:'PUT',body:{data:snapshot,revision:revision}});
      if(epoch!==auth.epoch)return false;
      state.data=snapshot;revision=result.revision;dirty=false;syncMessage('Planning enregistré dans ton compte.',false);return true;
    }catch(e){if(auth.user&&epoch===auth.epoch)syncMessage('Non enregistré : '+e.message,true);return false;}
    finally{buttons.forEach(function(b){b.disabled=false});}
  })();
  try{return await saving;}finally{saving=null;}
}
function offerLegacyImport(){
  var raw;try{raw=localStorage.getItem(KEY);}catch(e){return;}
  if(!raw)return;
  var box=document.createElement('section');box.className='settings card';
  box.innerHTML='<b>Ancien planning sur cet appareil</b><p class="note">Importe-le uniquement s’il t’appartient. Les journées déjà présentes dans ton compte seront conservées. La copie locale sera supprimée après une sauvegarde réussie.</p><button class="btn" id="migrateLocal">Importer dans mon compte</button>';
  document.getElementById('main').appendChild(box);
  box.querySelector('button').onclick=async function(){
    if(!confirm('Importer les données locales dans le compte '+auth.user.username+' ?'))return;
    try{
      var legacy=validatePlanning(JSON.parse(raw)),dates=new Set(state.data.entries.map(function(e){return e.date}));
      state.data.entries=state.data.entries.concat(legacy.entries.filter(function(e){return !dates.has(e.date)}));
      if(revision===0)state.data.settings=legacy.settings;
      if(await persist()){localStorage.removeItem(KEY);render();toast('Ancien planning importé');}
    }catch(e){syncMessage(e.message,true);}
  };
}
function showLegacyGateway(){
  document.getElementById('headerTarget').textContent='v0.07';
  var box=document.getElementById('authRoot');
  box.innerHTML='<section class="card auth-card"><h1>Ton planning a maintenant un compte</h1><p>MyPlanning continue sur son adresse sécurisée Cloudflare, avec la même interface.</p><p>Si tu utilisais cette ancienne adresse, exporte d’abord ton planning. Sur le nouveau site, crée ton compte puis ouvre Réglages → Restaurer JSON.</p><div class="actions"><button class="btn" id="exportLegacy">Exporter mon ancien planning</button><a class="btn primary" href="https://myplanning.v76y74m25h.workers.dev/">Ouvrir MyPlanning</a><button class="ghost" id="eraseLegacy">Effacer la copie locale</button></div><p id="legacyMessage" role="status"></p></section>';
  document.getElementById('exportLegacy').onclick=function(){try{var raw=localStorage.getItem(KEY);if(!raw)throw new Error('Aucun ancien planning trouvé dans ce navigateur.');var data=validatePlanning(JSON.parse(raw));download('myplanning-migration.json',JSON.stringify(data,null,2),'application/json');document.getElementById('legacyMessage').textContent='Sauvegarde exportée. Conserve-la jusqu’à la réussite de l’import.';}catch(e){document.getElementById('legacyMessage').textContent=e.message;}};
  document.getElementById('eraseLegacy').onclick=function(){if(confirm('As-tu vérifié ton planning sur le nouveau site ? Effacer maintenant cette copie locale ?')){localStorage.removeItem(KEY);document.getElementById('legacyMessage').textContent='Copie locale effacée.';}};
}
window.addEventListener('beforeunload',function(event){if(dirty||saving){event.preventDefault();event.returnValue='';}});
function iso(d){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')}
function fromIso(s){var p=s.split('-').map(Number);return new Date(p[0],p[1]-1,p[2])}
function startWeek(d){var x=new Date(d.getFullYear(),d.getMonth(),d.getDate()),g=x.getDay();x.setDate(x.getDate()+(g===0?-6:1-g));return x}
function addDays(d,n){var x=new Date(d);x.setDate(x.getDate()+n);return x}
function week(d){var s=startWeek(d),a=[];for(var i=0;i<7;i++)a.push(addDays(s,i));return a}
function minsTime(t){var p=t.split(':').map(Number);return p[0]*60+p[1]}
function segmentM(s){var a=minsTime(s.start),b=minsTime(s.end);if(b<a)b+=1440;return Math.max(0,b-a-(Number(s.breakMinutes)||0))}
function entryM(e){if(!e||e.type!=='work')return 0;return (e.segments||[]).reduce(function(n,s){return n+segmentM(s)},0)}
function fmt(m){var sign=m<0?'-':'';m=Math.abs(Math.round(m));return sign+Math.floor(m/60)+'h'+String(m%60).padStart(2,'0')}
function mapEntries(){var m=new Map();state.data.entries.forEach(function(e){m.set(e.date,e)});return m}
function uid(){return Math.random().toString(36).slice(2)+Date.now().toString(36)}
function blankSeg(){return{id:uid(),start:'09:00',end:'17:00',breakMinutes:0}}
function escapeHtml(s){return String(s||'').replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function toast(msg){var t=document.getElementById('toast');t.textContent=msg;t.classList.add('show');setTimeout(function(){t.classList.remove('show')},1700)}
function weekLabel(d){var a=week(d),s=a[0],e=a[6];if(s.getMonth()===e.getMonth())return s.getDate()+'–'+e.getDate()+' '+months[e.getMonth()]+' '+e.getFullYear();return s.getDate()+' '+months[s.getMonth()]+' – '+e.getDate()+' '+months[e.getMonth()]+' '+e.getFullYear()}
function longDate(d){var i=(d.getDay()+6)%7;return daysLong[i]+' '+d.getDate()+' '+months[d.getMonth()]}

function render(){
  if(!auth||!auth.user)return;
  document.querySelectorAll('.nav button[data-tab]').forEach(function(b){b.classList.toggle('active',b.dataset.tab===state.tab)});
  document.getElementById('headerTarget').textContent=fmt(state.data.settings.weeklyTargetMinutes).replace('h00',' h').replace('h',' h ')+'/ sem.';
  if(state.tab==='week')renderWeek();
  if(state.tab==='month')renderMonth();
  if(state.tab==='stats')renderStats();
  if(state.tab==='settings')renderSettings();
}
function renderWeek(){
  var m=mapEntries(),ds=week(state.anchor),total=ds.reduce(function(n,d){return n+entryM(m.get(iso(d)))},0),target=state.data.settings.weeklyTargetMinutes,diff=total-target;
  var h='<section class="period card"><button id="prev">‹</button><button class="period-main" id="today"><small>Semaine</small><strong>'+weekLabel(state.anchor)+'</strong></button><button id="next">›</button></section>';
  h+='<section class="summary"><div class="mini card"><span>Prévu</span><strong>'+fmt(total)+'</strong></div><div class="mini card"><span>Objectif</span><strong>'+fmt(target)+'</strong></div><div class="mini card"><span>Écart</span><strong class="'+(diff>=0?'positive':'negative')+'">'+(diff>0?'+':'')+fmt(diff)+'</strong></div></section>';h+='<section class="scan-card card"><div><strong>Importer un planning papier</strong><small>Photo → horaires détectés → calcul automatique</small></div><button class="btn primary" id="scanPlanning">📷 Scanner</button></section>';
  h+='<section class="week">';
  ds.forEach(function(d,i){var e=m.get(iso(d)),today=iso(d)===iso(new Date()),body='<span class="empty">Ajouter les horaires</span>',right='<strong>—</strong><small>libre</small>';
    if(e){if(e.type==='work'){body='<div class="segments">'+e.segments.map(function(s){return '<span class="pill work">'+escapeHtml(s.start)+' → '+escapeHtml(s.end)+(s.breakMinutes?' · '+s.breakMinutes+'m pause':'')+'</span>'}).join('')+'</div>';right='<strong>'+fmt(entryM(e))+'</strong><small>'+escapeHtml(e.note||'travail')+'</small>'}
    else{body='<span class="pill '+e.type+'">'+typeLabels[e.type]+'</span>';right='<strong>—</strong><small>'+escapeHtml(e.note||typeLabels[e.type])+'</small>'}}
    h+='<article class="day card '+(today?'today':'')+'" data-date="'+iso(d)+'"><div><div class="dow">'+days[i]+'</div><div class="date">'+d.getDate()+'</div></div><div>'+body+'</div><div class="hours">'+right+'</div></article>';
  });
  h+='</section>';document.getElementById('main').innerHTML=h;
  document.getElementById('prev').onclick=function(){state.anchor=addDays(state.anchor,-7);render()};
  document.getElementById('next').onclick=function(){state.anchor=addDays(state.anchor,7);render()};
  document.getElementById('today').onclick=function(){state.anchor=new Date();render()};
  document.querySelectorAll('.day').forEach(function(x){x.onclick=function(){openEditor(fromIso(x.dataset.date))}});document.getElementById('scanPlanning').onclick=openScanner;
}
function monthCells(d){var first=new Date(d.getFullYear(),d.getMonth(),1),s=startWeek(first),a=[];for(var i=0;i<42;i++)a.push(addDays(s,i));return a}
function renderMonth(){
  var m=mapEntries(),cells=monthCells(state.anchor),prefix=state.anchor.getFullYear()+'-'+String(state.anchor.getMonth()+1).padStart(2,'0')+'-',total=state.data.entries.filter(function(e){return e.date.indexOf(prefix)===0}).reduce(function(n,e){return n+entryM(e)},0);
  var h='<section class="month-head card"><button id="mprev">‹</button><div><b>'+months[state.anchor.getMonth()]+' '+state.anchor.getFullYear()+'</b><div style="color:var(--muted);font-size:12px">'+fmt(total)+' ce mois</div></div><button id="mnext">›</button></section><div class="month-grid" style="margin-top:8px">';
  days.forEach(function(d){h+='<div class="weekday">'+d+'</div>'});cells.forEach(function(d){var e=m.get(iso(d)),out=d.getMonth()!==state.anchor.getMonth(),today=iso(d)===iso(new Date());h+='<button class="cell '+(out?'out ':'')+(today?'today':'')+'" data-date="'+iso(d)+'"><b>'+d.getDate()+'</b>'+(e?'<i class="dot '+e.type+'"></i>':'')+(e&&e.type==='work'?'<small>'+fmt(entryM(e))+'</small>':'')+'</button>'});h+='</div>';
  document.getElementById('main').innerHTML=h;document.getElementById('mprev').onclick=function(){state.anchor=new Date(state.anchor.getFullYear(),state.anchor.getMonth()-1,1);render()};document.getElementById('mnext').onclick=function(){state.anchor=new Date(state.anchor.getFullYear(),state.anchor.getMonth()+1,1);render()};document.querySelectorAll('.cell').forEach(function(x){x.onclick=function(){openEditor(fromIso(x.dataset.date))}});
}
function renderStats(){
  var now=new Date(),rows=[];for(var i=5;i>=0;i--){var d=new Date(now.getFullYear(),now.getMonth()-i,1),p=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-',mm=state.data.entries.filter(function(e){return e.date.indexOf(p)===0}).reduce(function(n,e){return n+entryM(e)},0);rows.push({d:d,m:mm})}
  var max=Math.max.apply(null,rows.map(function(r){return r.m}).concat([60])),cur=rows[5].m,gross=state.data.settings.hourlyRateGross>0?(cur/60)*state.data.settings.hourlyRateGross:null;
  var h='<div class="section-title">Statistiques</div><section class="stats"><div class="bigstat card"><span>Ce mois-ci</span><strong>'+fmt(cur)+'</strong>'+(gross!==null?'<div style="color:var(--muted)">≈ '+gross.toFixed(2)+' € brut</div>':'<div style="color:var(--muted)">Ajoute ton taux horaire dans Réglages</div>')+'</div><div class="card bars">';
  rows.forEach(function(r){h+='<div class="barcol"><b>'+Math.round(r.m/60)+'h</b><div class="bar"><i style="height:'+Math.max(3,r.m/max*100)+'%"></i></div>'+months[r.d.getMonth()].slice(0,3)+'</div>'});h+='</div></section><div class="section-title">Historique 6 mois</div><section class="card">';
  rows.slice().reverse().forEach(function(r){h+='<div style="display:flex;justify-content:space-between;padding:14px 16px;border-bottom:1px solid var(--line)"><span>'+months[r.d.getMonth()]+' '+r.d.getFullYear()+'</span><b>'+fmt(r.m)+'</b></div>'});h+='</section>';document.getElementById('main').innerHTML=h;
}
function renderSettings(){
  var s=state.data.settings,h='<div class="section-title">Réglages</div><section class="settings card"><div class="field"><label>Nom du planning</label><input id="employeeLabel" value="'+escapeHtml(s.employeeLabel)+'"></div><div class="field"><label>Objectif hebdomadaire (heures)</label><input id="weeklyTarget" type="number" min="0" step="0.25" value="'+(s.weeklyTargetMinutes/60)+'"></div><div class="field"><label>Taux horaire brut (€) — optionnel</label><input id="hourlyRate" type="number" min="0" step="0.01" value="'+s.hourlyRateGross+'"></div><div class="field"><label>Nom sur le planning papier (pour le scanner)</label><input id="ocrEmployeeName" value="'+escapeHtml(s.ocrEmployeeName||'')+'" placeholder="Ex. CLEMENT"></div><button class="btn primary" id="saveSettings">Enregistrer les réglages</button><div class="section-title" style="margin:10px 0 0">Données</div><div class="actions"><button class="btn" id="exportIcs">Exporter calendrier .ics</button><button class="btn" id="exportJson">Sauvegarde JSON</button><button class="btn" id="importJson">Restaurer JSON</button></div><div class="note">Tes horaires sont privés et enregistrés dans ton compte. Une connexion internet est nécessaire pour les charger et les sauvegarder. Les photos du scanner sont transmises à Groq pour analyse.</div></section>';
  document.getElementById('main').innerHTML=h;
  document.getElementById('main').insertAdjacentHTML('afterbegin',auth.profileMarkup());auth.bindProfile();offerLegacyImport();
  document.getElementById('saveSettings').onclick=async function(){state.data.settings.employeeLabel=document.getElementById('employeeLabel').value||'Mon planning';state.data.settings.weeklyTargetMinutes=Math.round((Number(document.getElementById('weeklyTarget').value)||0)*60);state.data.settings.hourlyRateGross=Number(document.getElementById('hourlyRate').value)||0;state.data.settings.ocrEmployeeName=document.getElementById('ocrEmployeeName').value.trim();if(!await persist())return;toast('Réglages enregistrés');render()};
  document.getElementById('exportJson').onclick=exportJson;document.getElementById('importJson').onclick=function(){document.getElementById('importFile').click()};document.getElementById('exportIcs').onclick=exportIcs;
}

var scanDraft=null,scanImageUrl=null,scanGeneration=0;
var VISION_API='/scan';
function openScanner(){
  if(!auth.user)return;
  scanDraft=null;
  document.getElementById('scanName').value=state.data.settings.ocrEmployeeName||'';
  document.getElementById('scanWeekDate').value=iso(startWeek(state.anchor));
  document.getElementById('scanResults').innerHTML='';
  document.getElementById('scanPreview').classList.add('hidden');
  document.getElementById('scanTotal').classList.add('hidden');
  document.getElementById('importScan').classList.add('hidden');
  setScanStatus("Prends une photo bien droite, avec toute la ligne de ton nom et les jours visibles.",false,0);
  document.getElementById('scannerModal').classList.add('show');
}
function closeScanner(){document.getElementById('scannerModal').classList.remove('show')}
function setScanStatus(msg,busy,pct){
  var s=document.getElementById('scanStatus'),p=document.getElementById('scanProgress'),b=document.getElementById('scanProgressBar');
  s.textContent=msg;s.classList.toggle('busy',!!busy);
  p.classList.toggle('hidden',!busy);if(typeof pct==='number')b.style.width=Math.max(0,Math.min(100,pct))+'%';
}
function normWord(s){return String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'')}
function timesInText(s){
  s=String(s||'').replace(/[Oo]/g,'0');var out=[],m;
  var re1=/\b([01]?\d|2[0-3])\s*[:hH.]\s*([0-5]\d)?\b/g;
  while((m=re1.exec(s)))out.push(String(Number(m[1])).padStart(2,'0')+':'+String(Number(m[2]||0)).padStart(2,'0'));
  var stripped=s.replace(re1,' ');
  var re2=/\b([01]\d|2[0-3])([0-5]\d)\b/g;
  while((m=re2.exec(stripped)))out.push(m[1]+':'+m[2]);
  return out;
}
function parseTsv(tsv){
  if(!tsv)return[];var lines=tsv.split(/\r?\n/),head=lines.shift().split('\t'),idx={};
  head.forEach(function(x,i){idx[x]=i});
  return lines.map(function(line){var a=line.split('\t'),txt=a.slice(idx.text).join('\t');return {text:txt,left:Number(a[idx.left])||0,top:Number(a[idx.top])||0,width:Number(a[idx.width])||0,height:Number(a[idx.height])||0,conf:Number(a[idx.conf])||0,x:(Number(a[idx.left])||0)+(Number(a[idx.width])||0)/2,y:(Number(a[idx.top])||0)+(Number(a[idx.height])||0)/2}}).filter(function(w){return w.text&&w.conf>-1});
}
function median(a){if(!a.length)return 16;a=a.slice().sort(function(x,y){return x-y});return a[Math.floor(a.length/2)]}
function detectFromOcr(data,name,weekDate){
  var words=parseTsv(data.tsv),dayNames=[['lundi','lun','lu'],['mardi','mar','ma'],['mercredi','mer','me'],['jeudi','jeu','je'],['vendredi','ven','ve'],['samedi','sam','sa'],['dimanche','dim','di']];
  if(words.length<5)throw new Error("La photo a été lue, mais pas assez de zones ont été reconnues.");
  var nameParts=String(name).trim().split(/\s+/).map(normWord).filter(Boolean),nameWord=null,best=-1;
  if(!nameParts.length)throw new Error("Entre ton nom tel qu'il apparaît sur le planning.");
  function editDistance(a,b){var m=a.length,n=b.length,dp=Array(n+1);for(var j=0;j<=n;j++)dp[j]=j;for(var i=1;i<=m;i++){var prev=dp[0];dp[0]=i;for(var j=1;j<=n;j++){var tmp=dp[j],cost=a[i-1]===b[j-1]?0:1;dp[j]=Math.min(dp[j]+1,dp[j-1]+1,prev+cost);prev=tmp}}return dp[n]}
  function wordSimilarity(a,b){if(!a||!b)return 0;if(a===b)return 1;if(a.length>=4&&b.length>=4&&(a.indexOf(b)>=0||b.indexOf(a)>=0))return .88;var d=editDistance(a,b),mx=Math.max(a.length,b.length);return mx?1-d/mx:0}
  words.forEach(function(w){var n=normWord(w.text);if(!n)return;nameParts.forEach(function(p){var sim=wordSimilarity(n,p),score=sim*100+Math.max(0,w.conf)/20;if(score>best){best=score;nameWord=w}})});
  // Sur les photos de tableau, un nom en petites capitales peut perdre 1–2 lettres à l'OCR.
  // On accepte une correspondance floue, mais uniquement si elle reste suffisamment proche.
  if(!nameWord||best<62){
    // Dernier fallback : la ligne salarié se situe à gauche des colonnes horaires.
    // Chercher un mot de taille proche du nom et ressemblant partiellement au patronyme.
    var target=nameParts[0],candidates=words.filter(function(w){var n=normWord(w.text);return n.length>=Math.max(4,target.length-3)&&n.length<=target.length+3&&w.x<(words.reduce(function(mx,z){return Math.max(mx,z.left+z.width)},0)*.45)});
    candidates.forEach(function(w){var n=normWord(w.text),sim=wordSimilarity(n,target),score=sim*100+Math.max(0,w.conf)/30;if(score>best){best=score;nameWord=w}});
  }
  var weakName=!nameWord||best<52;
  if(weakName){
    // Ne plus bloquer l'import uniquement parce que le nom est minuscule.
    // On cherchera une ligne plausible contenant des horaires sur les 7 colonnes.
    nameWord=null;
  }

  // 1) Repérer les colonnes de jours quand elles sont lisibles.
  var rawHeaders=[];
  dayNames.forEach(function(names,di){
    var cand=words.filter(function(w){var n=normWord(w.text);return names.some(function(k){return n===k||n.indexOf(k)===0})});
    if(cand.length){cand.sort(function(a,b){return a.top-b.top||b.conf-a.conf});rawHeaders.push({day:di,x:cand[0].x,y:cand[0].y,word:cand[0]})}
  });
  rawHeaders.sort(function(a,b){return a.x-b.x});
  var headers=[];
  rawHeaders.forEach(function(h){if(!headers.some(function(x){return Math.abs(x.x-h.x)<8}))headers.push(h)});

  // 2) Reconstruire la grille. On ne dépend plus de 3 titres de jours.
  // Le planning ALDI place Nom/Prénom/Base horaire à gauche puis 7 colonnes régulières.
  var allRight=words.reduce(function(mx,w){return Math.max(mx,w.left+w.width)},0);
  var allLeft=words.reduce(function(mn,w){return Math.min(mn,w.left)},Infinity);
  if(!isFinite(allLeft))allLeft=0;
  var dayStart=null,dayEnd=null,colW=null;
  if(headers.length>=2){
    var known=headers.slice().sort(function(x,y){return x.day-y.day}),steps=[];
    for(var hi=1;hi<known.length;hi++){var dd=known[hi].day-known[hi-1].day;if(dd>0)steps.push((known[hi].x-known[hi-1].x)/dd)}
    var step=median(steps.filter(function(x){return x>8}));
    if(isFinite(step)&&step>8){
      var origins=known.map(function(h){return h.x-h.day*step});
      var mondayX=median(origins);
      colW=step;dayStart=mondayX-colW*.5;dayEnd=dayStart+7*colW;
    }
  }
  if(!colW||!isFinite(colW)||colW<12){
    // Fallback structurel : chercher les heures et utiliser la largeur utile du tableau.
    // Sur ce format, les 7 jours occupent approximativement les 70% droits du tableau.
    var tableW=allRight-allLeft;
    dayStart=allLeft+tableW*.29;dayEnd=allRight-tableW*.015;colW=(dayEnd-dayStart)/7;
  }
  if(!isFinite(colW)||colW<12)throw new Error("La grille du planning est trop petite pour être analysée.");
  // 3) La ligne d'un salarié peut contenir 2 sous-lignes (journée coupée).
  var mh=median(words.map(function(w){return w.height}).filter(function(x){return x>3}));
  var rowTol=Math.max(26,mh*3.0),anchorY=nameWord?nameWord.y:null;
  if(anchorY===null){
    // Regrouper les tokens horaires par bande horizontale et choisir la bande
    // qui ressemble le plus à une ligne salarié (plusieurs jours / plusieurs horaires).
    var tw=words.filter(function(w){return timesInText(w.text).length&&w.x>=dayStart-colW*.2&&w.x<=dayEnd+colW*.2}),bands=[];
    tw.sort(function(a,b){return a.y-b.y}).forEach(function(w){
      var b=bands.find(function(x){return Math.abs(x.y-w.y)<=Math.max(10,mh*1.4)});
      if(!b){b={y:w.y,items:[],xs:[]};bands.push(b)}
      b.items.push(w);b.xs.push(w.x);b.y=b.items.reduce(function(n,z){return n+z.y},0)/b.items.length;
    });
    bands.forEach(function(b){var cols={};b.items.forEach(function(w){cols[Math.max(0,Math.min(6,Math.floor((w.x-dayStart)/colW)))]=1});b.score=Object.keys(cols).length*20+b.items.length*5});
    bands.sort(function(a,b){return b.score-a.score});
    if(!bands.length||bands[0].score<25)throw new Error("Je lis la photo, mais je n'arrive pas à isoler une ligne salarié contenant des horaires.");
    anchorY=bands[0].y;
  }
  // Le texte du nom et les heures ne sont pas toujours centrés à la même hauteur.
  // Recaler l'ancre sur la bande horaire la plus proche.
  var nearbyTimes=words.filter(function(w){return timesInText(w.text).length&&w.x>=dayStart-colW*.2&&w.x<=dayEnd+colW*.2});
  if(nameWord&&nearbyTimes.length){
    nearbyTimes.sort(function(a,b){return Math.abs(a.y-nameWord.y)-Math.abs(b.y-nameWord.y)});
    if(Math.abs(nearbyTimes[0].y-nameWord.y)<rowTol*2.5)anchorY=nearbyTimes[0].y;
  }
  var rowWords=words.filter(function(w){return Math.abs(w.y-anchorY)<=rowTol&&w.x>=dayStart-colW*.2&&w.x<=dayEnd+colW*.2});
  var byDay={};for(var d=0;d<7;d++)byDay[d]=[];
  rowWords.forEach(function(w){
    var ts=timesInText(w.text);if(!ts.length)return;
    var di=Math.floor((w.x-dayStart)/colW);di=Math.max(0,Math.min(6,di));
    ts.forEach(function(t){byDay[di].push({time:t,x:w.x,y:w.y,conf:w.conf})});
  });

  var ws=startWeek(fromIso(weekDate)),draft=[];
  for(var di=0;di<7;di++){
    var arr=byDay[di].sort(function(a,b){return a.y-b.y||a.x-b.x}),lines=[];
    arr.forEach(function(t){
      var line=lines.find(function(l){return Math.abs(l.y-t.y)<=Math.max(8,mh*.9)});
      if(!line){line={y:t.y,times:[]};lines.push(line)}
      line.times.push(t);
    });
    var ordered=[];
    lines.sort(function(a,b){return a.y-b.y}).forEach(function(line){
      line.times.sort(function(a,b){return a.x-b.x});
      line.times.forEach(function(t){if(ordered[ordered.length-1]!==t.time)ordered.push(t.time)});
    });
    var segs=[];
    for(var j=0;j+1<ordered.length;j+=2){
      var a=minsTime(ordered[j]),b=minsTime(ordered[j+1]);
      if(ordered[j]!==ordered[j+1]&&((b-a+1440)%1440)<=16*60)segs.push({id:uid(),start:ordered[j],end:ordered[j+1],breakMinutes:0});
    }
    draft.push({date:iso(addDays(ws,di)),day:di,segments:segs});
  }
  var count=draft.reduce(function(n,x){return n+x.segments.length},0);
  if(!count)throw new Error("J'ai trouvé ton nom et les colonnes, mais pas assez d'horaires fiables. Rapproche-toi du tableau et garde toute ta ligne visible.");
  return draft;
}
function loadTesseract(){
  if(window.Tesseract)return Promise.resolve();
  return new Promise(function(resolve,reject){var s=document.createElement('script');s.src='https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';s.onload=resolve;s.onerror=function(){reject(new Error("Impossible de charger le moteur local de lecture photo."))};document.head.appendChild(s)});
}
function ocrScore(data,name){
  var text=normWord((data&&data.text)||''),parts=String(name||'').split(/\s+/).map(normWord).filter(Boolean),score=0;
  parts.forEach(function(p){if(text.indexOf(p)>=0)score+=120});
  var times=timesInText((data&&data.text)||'');score+=times.length*18;
  if(data&&data.tsv)score+=Math.min(100,(data.tsv.match(/\t/g)||[]).length/20);
  return score;
}
function fileToDataUrl(file){return new Promise(function(resolve,reject){var r=new FileReader();r.onload=function(){resolve(r.result)};r.onerror=reject;r.readAsDataURL(file)})}
function enhanceForOcr(dataUrl){
  return new Promise(function(resolve){
    var im=new Image();im.onload=function(){
      var maxW=2600,scale=Math.min(3,Math.max(1.4,maxW/im.width)),cv=document.createElement('canvas');
      cv.width=Math.round(im.width*scale);cv.height=Math.round(im.height*scale);
      var ctx=cv.getContext('2d');ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.drawImage(im,0,0,cv.width,cv.height);
      var id=ctx.getImageData(0,0,cv.width,cv.height),p=id.data;
      for(var i=0;i<p.length;i+=4){var y=.299*p[i]+.587*p[i+1]+.114*p[i+2],v=y<128?Math.max(0,y*.78):Math.min(255,128+(y-128)*1.22);p[i]=p[i+1]=p[i+2]=v}
      ctx.putImageData(id,0,0);resolve(cv.toDataURL('image/jpeg',.94));
    };im.onerror=function(){resolve(dataUrl)};im.src=dataUrl;
  })
}
function makeOcrVariant(dataUrl,mode){
  return new Promise(function(resolve){
    var im=new Image();im.onload=function(){
      var scale=Math.min(3.2,Math.max(1.6,2800/im.width)),cv=document.createElement('canvas');cv.width=Math.round(im.width*scale);cv.height=Math.round(im.height*scale);
      var ctx=cv.getContext('2d');ctx.drawImage(im,0,0,cv.width,cv.height);var id=ctx.getImageData(0,0,cv.width,cv.height),p=id.data;
      for(var i=0;i<p.length;i+=4){var y=.299*p[i]+.587*p[i+1]+.114*p[i+2],v;
        if(mode==='binary')v=y<172?0:255;
        else v=Math.max(0,Math.min(255,(y-128)*1.55+128));
        p[i]=p[i+1]=p[i+2]=v;
      }
      ctx.putImageData(id,0,0);resolve(cv.toDataURL('image/jpeg',.95));
    };im.onerror=function(){resolve(dataUrl)};im.src=dataUrl;
  })
}
function compressForVision(dataUrl){
  return new Promise(function(resolve){
    var im=new Image();
    im.onload=function(){
      var maxDim=2200,scale=Math.min(1,maxDim/Math.max(im.width,im.height));
      var cv=document.createElement('canvas');
      cv.width=Math.max(1,Math.round(im.width*scale));cv.height=Math.max(1,Math.round(im.height*scale));
      var ctx=cv.getContext('2d');ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
      ctx.drawImage(im,0,0,cv.width,cv.height);
      resolve(cv.toDataURL('image/jpeg',.9));
    };
    im.onerror=function(){resolve(dataUrl)};
    im.src=dataUrl;
  });
}
function validClock(t){
  return typeof t==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(t);
}
function visionPlanningToDraft(planning,weekDate){
  if(!planning||!Array.isArray(planning.days))throw new Error("L'IA a renvoyé un planning incomplet.");
  var map={monday:0,tuesday:1,wednesday:2,thursday:3,friday:4,saturday:5,sunday:6};
  var ws=startWeek(fromIso(weekDate)),by={};
  planning.days.forEach(function(d){
    var di=map[String(d.day||'').toLowerCase()];
    if(di===undefined)return;
    var segs=[];
    (Array.isArray(d.shifts)?d.shifts:[]).forEach(function(s){
      if(validClock(s.start)&&validClock(s.end)&&s.start!==s.end){
        segs.push({id:uid(),start:s.start,end:s.end,breakMinutes:0});
      }
    });
    by[di]=segs;
  });
  var draft=[];
  for(var i=0;i<7;i++)draft.push({date:iso(addDays(ws,i)),day:i,segments:by[i]||[]});
  return draft;
}
async function scanWithServerVision(name,weekDate,imageData,isCurrent){
  setScanStatus("Envoi sécurisé au scanner IA…",true,15);
  var prepared=await compressForVision(imageData);
  if(!isCurrent())throw new Error('Le compte actif a changé.');
  setScanStatus("Groq Vision analyse le tableau et cherche "+name+"…",true,45);
  var controller=new AbortController(),timer=setTimeout(function(){controller.abort()},45000);
  var data;
  try{
    data=await auth.api(VISION_API,{method:'POST',body:{employee:name,image:prepared},signal:controller.signal});
  }finally{clearTimeout(timer)}
  var p=data.planning||{},confidence=Number(p.confidence)||0;
  if(!p.employee_found&&confidence<40)throw new Error("L'IA n'a pas identifié "+name+" avec assez de certitude.");
  var draft=visionPlanningToDraft(p,weekDate);
  var count=draft.reduce(function(n,d){return n+d.segments.length},0);
  if(!count)throw new Error("L'IA a trouvé la ligne, mais aucun horaire suffisamment lisible.");
  return {draft:draft,confidence:confidence,employee:p.employee_found||name,warnings:Array.isArray(p.warnings)?p.warnings:[]};
}
async function scanPhotoLocalFallback(name,weekDate){
  setScanStatus("Serveur IA indisponible : tentative OCR locale de secours…",true,5);
  var variants=await Promise.all([enhanceForOcr(scanImageUrl),makeOcrVariant(scanImageUrl,'contrast'),makeOcrVariant(scanImageUrl,'binary')]);await loadTesseract();
  var worker=await Tesseract.createWorker('fra',1,{logger:function(m){if(m&&typeof m.progress==='number')setScanStatus("OCR de secours : "+Math.round(m.progress*100)+" %",true,8+m.progress*25)}});
  await worker.setParameters({preserve_interword_spaces:'1'});
  var draftCandidates=[];
  for(var vi=0;vi<variants.length;vi++){
    var rr=await worker.recognize(variants[vi],{}, {text:true,tsv:true});
    try{
      var dd=detectFromOcr(rr.data,name,weekDate),segments=dd.reduce(function(n,x){return n+x.segments.length},0),minutes=dd.reduce(function(n,x){return n+x.segments.reduce(function(a,s){return a+segmentM(s)},0)},0);
      draftCandidates.push({draft:dd,score:ocrScore(rr.data,name)+segments*80+(minutes>0&&minutes<70*60?60:0)});
    }catch(parseErr){}
  }
  await worker.terminate();
  if(!draftCandidates.length)throw new Error("Le serveur IA et l'OCR local n'ont pas réussi à lire ce planning.");
  draftCandidates.sort(function(a,b){return b.score-a.score});
  return draftCandidates[0].draft;
}
async function scanPhoto(file){
  if(!auth.user)return;var scanEpoch=auth.epoch,scanRun=++scanGeneration;
  function isCurrent(){return auth.user&&scanEpoch===auth.epoch&&scanRun===scanGeneration;}
  var name=document.getElementById('scanName').value.trim(),weekDate=document.getElementById('scanWeekDate').value;
  if(!name){setScanStatus("Entre d'abord ton nom tel qu'il apparaît sur le planning.",false);return}
  if(!weekDate){setScanStatus("Choisis un jour appartenant à la semaine photographiée.",false);return}
  try{
    var imageData=await fileToDataUrl(file);if(!isCurrent())return;scanImageUrl=imageData;
    var img=document.getElementById('scanPreview');img.src=scanImageUrl;img.classList.remove('hidden');
    document.getElementById('scanResults').innerHTML='';document.getElementById('importScan').classList.add('hidden');document.getElementById('scanTotal').classList.add('hidden');
    var serverResult=null,serverError=null;
    try{
      serverResult=await scanWithServerVision(name,weekDate,scanImageUrl,isCurrent);
      if(!isCurrent())return;
      scanDraft=serverResult.draft;
      var msg="Analyse IA terminée";
      if(serverResult.confidence)msg+=" · confiance "+Math.round(serverResult.confidence)+" %";
      msg+=". Vérifie les horaires avant l'import.";
      if(serverResult.warnings.length)msg+=" "+serverResult.warnings.join(" ");
      setScanStatus(msg,false,100);
    }catch(e){
      if(!isCurrent()||e.status===401||e.status===403||e.status===429)throw e;
      serverError=e;
      try{
        scanDraft=await scanPhotoLocalFallback(name,weekDate);
        setScanStatus("Groq Vision n'a pas pu terminer ("+(serverError.message||"erreur")+"). Résultat OCR local de secours : vérifie attentivement les horaires.",false,100);
      }catch(localError){
        throw new Error((serverError&&serverError.message?serverError.message:"Échec du scanner IA")+" · Secours local : "+(localError.message||"échec"));
      }
    }
    if(!isCurrent())return;
    renderScanDraft();
  }catch(e){
    if(!isCurrent())return;
    scanDraft=null;document.getElementById('scanResults').innerHTML='';document.getElementById('importScan').classList.add('hidden');document.getElementById('scanTotal').classList.add('hidden');
    setScanStatus(e&&e.name==='AbortError'?"Le serveur IA a mis trop de temps à répondre. Réessaie.":(e&&e.message?e.message:"La lecture de la photo a échoué."),false);
  }
}
function renderScanDraft(){
  var box=document.getElementById('scanResults');box.innerHTML='';
  scanDraft.forEach(function(day){
    var d=fromIso(day.date),el=document.createElement('div');el.className='scan-day';
    var inner='<div class="scan-day-head"><b>'+daysLong[day.day]+' '+d.getDate()+' '+months[d.getMonth()]+'</b><span>'+fmt(day.segments.reduce(function(n,s){return n+segmentM(s)},0))+'</span></div>';
    if(!day.segments.length)inner+='<div class="emptyline">Aucun horaire détecté</div>';
    day.segments.forEach(function(s,si){inner+='<div class="timegrid" style="margin-top:7px"><div class="field"><label>Début</label><input type="time" data-day="'+day.day+'" data-seg="'+si+'" data-k="start" value="'+s.start+'"></div><div class="field"><label>Fin</label><input type="time" data-day="'+day.day+'" data-seg="'+si+'" data-k="end" value="'+s.end+'"></div></div>'});
    el.innerHTML=inner;box.appendChild(el);
  });
  box.querySelectorAll('input[type=time]').forEach(function(inp){inp.oninput=function(){var day=scanDraft.find(function(x){return x.day===Number(inp.dataset.day)}),s=day.segments[Number(inp.dataset.seg)];s[inp.dataset.k]=inp.value;renderScanTotal()}});
  document.getElementById('importScan').classList.remove('hidden');document.getElementById('scanTotal').classList.remove('hidden');renderScanTotal();
}
function renderScanTotal(){var total=(scanDraft||[]).reduce(function(n,d){return n+d.segments.reduce(function(a,s){return a+segmentM(s)},0)},0);document.querySelector('#scanTotal strong').textContent=fmt(total)}
async function importScannedPlanning(){
  if(!auth.user)return;
  if(!scanDraft)return;
  scanDraft.forEach(function(d){
    if(!d.segments.length)return;
    state.data.entries=state.data.entries.filter(function(e){return e.date!==d.date});
    state.data.entries.push({date:d.date,type:'work',segments:d.segments,note:'Import photo'});
  });
  state.data.entries.sort(function(a,b){return a.date.localeCompare(b.date)});state.data.settings.ocrEmployeeName=document.getElementById('scanName').value.trim();if(!await persist())return;state.anchor=fromIso(scanDraft[0].date);state.tab='week';closeScanner();render();toast('Planning importé et heures calculées');
}
function resetScan(){
  scanGeneration++;
  scanDraft=null;scanImageUrl=null;document.getElementById('scanResults').innerHTML='';document.getElementById('scanPreview').src='';document.getElementById('scanPreview').classList.add('hidden');document.getElementById('importScan').classList.add('hidden');document.getElementById('scanTotal').classList.add('hidden');setScanStatus("Prends une photo bien droite, avec toute la ligne de ton nom et les jours visibles.",false,0);
}

function openEditor(d){
  if(!auth.user||saving)return;
  var date=iso(d),existing=state.data.entries.find(function(e){return e.date===date});state.editing=existing?JSON.parse(JSON.stringify(existing)):{date:date,type:'work',segments:[blankSeg()],note:''};
  document.getElementById('editTitle').textContent=longDate(d);drawEditor();document.getElementById('modal').classList.add('show')
}
function drawEditor(){
  var e=state.editing,types=document.getElementById('typeButtons');types.innerHTML='';Object.keys(typeLabels).forEach(function(t){var b=document.createElement('button');b.textContent=typeLabels[t];b.className=e.type===t?'active':'';b.onclick=function(){e.type=t;if(t==='work'&&e.segments.length===0)e.segments=[blankSeg()];drawEditor()};types.appendChild(b)});
  var w=document.getElementById('segmentsWrap');w.innerHTML='';document.getElementById('addSegment').classList.toggle('hidden',e.type!=='work');document.getElementById('editTotal').parentElement.classList.toggle('hidden',e.type!=='work');
  if(e.type==='work')e.segments.forEach(function(s,idx){var div=document.createElement('div');div.className='seg';div.innerHTML='<div class="seg-head"><b>Créneau '+(idx+1)+'</b>'+(e.segments.length>1?'<button class="btn danger rm" data-id="'+s.id+'">Retirer</button>':'')+'</div><div class="timegrid"><div class="field"><label>Début</label><input class="st" type="time" value="'+s.start+'"></div><div class="field"><label>Fin</label><input class="en" type="time" value="'+s.end+'"></div><div class="field break"><label>Pause non payée (min)</label><input class="br" type="number" min="0" step="5" value="'+(s.breakMinutes||0)+'"></div></div>';w.appendChild(div);var st=div.querySelector('.st'),en=div.querySelector('.en'),br=div.querySelector('.br');st.oninput=function(){s.start=st.value;updateEditTotal()};en.oninput=function(){s.end=en.value;updateEditTotal()};br.oninput=function(){s.breakMinutes=Number(br.value)||0;updateEditTotal()};var rm=div.querySelector('.rm');if(rm)rm.onclick=function(){e.segments=e.segments.filter(function(x){return x.id!==s.id});drawEditor()}});
  document.getElementById('noteInput').value=e.note||'';updateEditTotal();
}
function updateEditTotal(){document.getElementById('editTotal').textContent=fmt(entryM(state.editing))}
function closeModal(){document.getElementById('modal').classList.remove('show');state.editing=null}
async function saveEdit(){if(!auth.user||!state.editing)return;state.editing.note=document.getElementById('noteInput').value;state.data.entries=state.data.entries.filter(function(e){return e.date!==state.editing.date});state.data.entries.push(state.editing);state.data.entries.sort(function(a,b){return a.date.localeCompare(b.date)});if(!await persist())return;closeModal();render();toast('Planning enregistré')}
async function deleteEdit(){if(!auth.user)return;if(!state.editing)return;state.data.entries=state.data.entries.filter(function(e){return e.date!==state.editing.date});if(!await persist())return;closeModal();render();toast('Journée supprimée')}
function download(name,text,type){var b=new Blob([text],{type:type}),u=URL.createObjectURL(b),a=document.createElement('a');a.href=u;a.download=name;a.click();setTimeout(function(){URL.revokeObjectURL(u)},500)}
function exportJson(){download('myplanning-'+iso(new Date())+'.json',JSON.stringify(state.data,null,2),'application/json')}
function icsDate(date,time){var p=date.split('-'),t=time.split(':');return p[0]+p[1]+p[2]+'T'+t[0]+t[1]+'00'}
function exportIcs(){var out=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//MyPlanning//FR','CALSCALE:GREGORIAN'];state.data.entries.filter(function(e){return e.type==='work'}).forEach(function(e){e.segments.forEach(function(s){var endDate=e.date;if(minsTime(s.end)<minsTime(s.start))endDate=iso(addDays(fromIso(e.date),1));out.push('BEGIN:VEVENT','UID:'+s.id+'@myplanning','DTSTART:'+icsDate(e.date,s.start),'DTEND:'+icsDate(endDate,s.end),'SUMMARY:Travail - '+(state.data.settings.employeeLabel||'MyPlanning'),'DESCRIPTION:'+(e.note||'').replace(/\n/g,' '),'END:VEVENT')})});out.push('END:VCALENDAR');download('myplanning.ics',out.join('\r\n'),'text/calendar')}
async function importJsonFile(file){
  if(!auth.user)return;var epoch=auth.epoch;
  try{
    if(file.size>2000000)throw new Error('Sauvegarde trop volumineuse (2 Mo maximum).');
    var data=validatePlanning(JSON.parse(await file.text()));
    if(epoch!==auth.epoch||!auth.user)return;
    if(!confirm('Remplacer le planning du compte '+auth.user.username+' par cette sauvegarde ('+data.entries.length+' journées) ?'))return;
    state.data=data;if(!await persist())return;render();toast('Sauvegarde restaurée');
  }catch(e){syncMessage('Import impossible : '+e.message,true);}
}

document.querySelectorAll('.nav button[data-tab]').forEach(function(b){b.onclick=function(){state.tab=b.dataset.tab;render()}});
document.getElementById('quickAdd').onclick=function(){openEditor(new Date())};
document.getElementById('closeScanner').onclick=closeScanner;
document.getElementById('scannerModal').onclick=function(e){if(e.target.id==='scannerModal')closeScanner()};
document.getElementById('takePhoto').onclick=function(){document.getElementById('photoCamera').click()};
document.getElementById('pickPhoto').onclick=function(){document.getElementById('photoGallery').click()};
document.getElementById('photoCamera').onchange=function(){if(this.files&&this.files[0])scanPhoto(this.files[0]);this.value=''};
document.getElementById('photoGallery').onchange=function(){if(this.files&&this.files[0])scanPhoto(this.files[0]);this.value=''};
document.getElementById('importScan').onclick=importScannedPlanning;
document.getElementById('clearScan').onclick=resetScan;
document.getElementById('closeModal').onclick=closeModal;document.getElementById('modal').onclick=function(e){if(e.target.id==='modal')closeModal()};
document.getElementById('addSegment').onclick=function(){state.editing.segments.push(blankSeg());drawEditor()};
document.getElementById('saveEntry').onclick=saveEdit;document.getElementById('deleteEntry').onclick=deleteEdit;
document.getElementById('noteInput').oninput=function(){if(state.editing)state.editing.note=this.value};
document.getElementById('importFile').onchange=function(){if(this.files&&this.files[0])importJsonFile(this.files[0]);this.value=''};
if('serviceWorker' in navigator)window.addEventListener('load',function(){navigator.serviceWorker.register('./sw.js').catch(function(){})});
auth=new AuthUI({onLogin:loadAccount,onLogout:clearPrivateState,onError:function(message){syncMessage(message,true);},beforeLogout:async function(){if(saving)await saving;if(dirty)return confirm('Des modifications ne sont pas enregistrées. Les abandonner et se déconnecter ?');return true;}});
if(location.hostname==='clemen5t.github.io')showLegacyGateway();else auth.boot();
})();
