const escape = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const input = (id,label,type='text',autocomplete='',extra='') => `<div class="field"><label for="${id}">${label}</label><input id="${id}" name="${id}" type="${type}" autocomplete="${autocomplete}" required ${extra}></div>`;
const passwordInput = (id,label='Mot de passe') => input(id,label,'password','new-password','minlength="12" maxlength="128"');
export class AuthUI {
  constructor({onLogin,onLogout,onError,beforeLogout}) {
    Object.assign(this,{onLogin,onLogout,onError,beforeLogout,user:null,csrf:null,epoch:0,controllers:new Set()});
    this.root=document.getElementById('authRoot');
    this.channel=typeof BroadcastChannel==='function'?new BroadcastChannel('myplanning-auth'):null;
    if(this.channel) this.channel.onmessage=()=>{this.reset();this.boot();};
    window.addEventListener('focus',()=>this.checkSession());
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)this.checkSession();});
    setInterval(()=>{if(!document.hidden)this.checkSession();},60000);
  }
  reset(message='') {
    this.epoch++;
    for(const controller of this.controllers)controller.abort();
    this.controllers.clear();this.user=null;this.csrf=null;this.onLogout();this.show('login',message);
  }
  async api(path,{method='GET',body,signal}={}) {
    const epoch=this.epoch,controller=new AbortController();this.controllers.add(controller);
    const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});
    const timer=setTimeout(abort,path.includes('scan')?45000:20000);
    try {
      const response=await fetch(path,{method,credentials:'same-origin',cache:'no-store',headers:{...(body?{'Content-Type':'application/json'}:{}),...(this.csrf?{'X-CSRF-Token':this.csrf}: {})},body:body?JSON.stringify(body):undefined,signal:controller.signal});
      const data=await response.json().catch(()=>({error:'Réponse du serveur illisible.'}));
      if(epoch!==this.epoch) throw new Error('Le compte actif a changé.');
      if(!response.ok) {
        const error=new Error(data.error||'Service indisponible.');error.status=response.status;
        if(response.status===401&&!path.endsWith('/login'))this.reset('Ta session a expiré. Reconnecte-toi.');
        throw error;
      }
      return data;
    } finally {clearTimeout(timer);signal?.removeEventListener('abort',abort);this.controllers.delete(controller);}
  }
  async accept(result) {
    const epoch=this.epoch;
    this.user=result.user;this.csrf=result.csrfToken;
    try { await this.onLogin(result.user); }
    catch(error) { if(epoch===this.epoch)this.reset(error.message); throw error; }
    if(epoch!==this.epoch)return;
    this.root.replaceChildren();
  }
  async boot() {
    const params=new URLSearchParams(location.hash.slice(1));
    // Email templates use fragment token hashes so they never enter request logs.
    if(params.has('token_hash')) {
      this.tokenHash=params.get('token_hash'); const type=params.get('type');
      history.replaceState(null,'',location.pathname);
      this.show(type==='recovery'?'reset':'confirm');return;
    }
    if(location.hash.includes('access_token')) {history.replaceState(null,'',location.pathname);this.show('login','Email confirmé. Connecte-toi avec ton mot de passe.');return;}
    this.root.innerHTML='<section class="card auth-card"><p role="status">Vérification de la session…</p></section>';
    try {await this.accept(await this.api('/api/auth/session'));}
    catch(e) {if(e.status!==401)this.reset(e.message);}
  }
  async checkSession() {
    if(!this.user||this.checking)return;this.checking=true;
    try {
      const previous=this.user.id, result=await this.api('/api/auth/session');
      if(previous!==result.user.id){this.reset();await this.accept(result);}
      else this.csrf=result.csrfToken;
    } catch(e) {if(e.status!==401)this.onError?.('Connexion indisponible. Tes modifications doivent être sauvegardées avant de quitter.');}
    finally{this.checking=false;}
  }
  show(mode='login',message='') {
    const titles={login:'Ravi de te retrouver',register:'Créer mon compte',forgot:'Mot de passe oublié',reset:'Choisir un mot de passe',confirm:'Confirmer mon email'};
    let fields='';
    if(mode==='register') fields=input('displayName','Ton nom','text','name','maxlength="80"')+input('username','Identifiant','text','username','minlength="3" maxlength="30" pattern="[a-zA-Z0-9][a-zA-Z0-9._-]{2,29}"')+input('email','Email','email','email','maxlength="254"')+passwordInput('password')+passwordInput('passwordConfirm','Confirmer le mot de passe');
    if(mode==='login') fields=input('identifier','Identifiant ou email','text','username','maxlength="254"')+input('password','Mot de passe','password','current-password','maxlength="128"');
    if(mode==='forgot') fields=input('email','Email','email','email');
    if(mode==='reset') fields=passwordInput('password')+passwordInput('passwordConfirm','Confirmer le mot de passe');
    const labels={login:'Se connecter',register:'Créer mon compte',forgot:'Envoyer le lien',reset:'Enregistrer',confirm:'Confirmer mon email'};
    this.root.innerHTML=`<section class="card auth-card"><h1>${titles[mode]}</h1><p class="auth-message">Ton planning personnel, retrouvé sur tous tes appareils.</p><form id="authForm">${fields}<p id="authMessage" class="auth-message" role="status" aria-live="polite">${escape(message)}</p><button class="btn primary" type="submit">${labels[mode]}</button></form>${mode==='register'||mode==='reset'?'<p class="note">Utilise une phrase de passe d’au moins 12 caractères (maximum 72 octets). Ton email servira à confirmer et récupérer ton compte.</p>':''}<div class="actions"><button class="btn" data-mode="${mode==='login'?'register':'login'}">${mode==='login'?'Créer un compte':'Retour à la connexion'}</button>${mode==='login'?'<button class="ghost" data-mode="forgot">Mot de passe oublié</button>':''}</div></section>`;
    this.root.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>this.show(b.dataset.mode));
    this.root.querySelector('form').onsubmit=async event=>{
      event.preventDefault();const form=event.currentTarget,button=form.querySelector('button'),status=form.querySelector('#authMessage');
      const values=Object.fromEntries(new FormData(form));button.disabled=true;status.textContent='Un instant…';
      try {
        if(values.passwordConfirm!==undefined&&values.password!==values.passwordConfirm)throw new Error('Les mots de passe ne correspondent pas.');
        delete values.passwordConfirm;
        const routes={login:'login',register:'register',forgot:'forgot-password',reset:'reset-password',confirm:'confirm'};
        if(mode==='reset'||mode==='confirm')values.tokenHash=this.tokenHash;
        const result=await this.api('/api/auth/'+routes[mode],{method:'POST',body:values});
        form.reset();
        if(mode==='login') {this.onLogout();this.channel?.postMessage('changed');await this.accept(result);}
        else {this.tokenHash=null;if(mode==='reset'){this.reset(result.message);this.channel?.postMessage('changed');}else this.show('login',result.message);}
      } catch(e) {status.textContent=e.message;}
      finally {form.querySelectorAll('input[type=password]').forEach(x=>x.value='');button.disabled=false;}
    };
  }
  profileMarkup() {
    const u=this.user;
    return `<section class="settings card" style="margin-bottom:14px"><h2 class="profile-title">Mon profil</h2><form id="profileForm"><div class="field"><label for="profileName">Nom affiché</label><input id="profileName" required maxlength="80" value="${escape(u.displayName)}"></div><div class="field"><label for="profileUsername">Identifiant</label><input id="profileUsername" required minlength="3" maxlength="30" value="${escape(u.username)}"></div><p class="note">Email confirmé : ${escape(u.email)}</p><button class="btn primary">Enregistrer mon profil</button></form><form id="passwordForm">${input('currentPassword','Mot de passe actuel','password','current-password','maxlength="128"')}${passwordInput('newPassword','Nouveau mot de passe')}<button class="btn" style="margin-top:12px">Changer mon mot de passe</button></form><p id="profileMessage" role="status" aria-live="polite"></p><div class="actions"><button class="btn" id="logout">Se déconnecter</button><button class="ghost" id="logoutAll">Déconnecter tous mes appareils</button></div></section>`;
  }
  bindProfile() {
    const status=document.getElementById('profileMessage');
    const submit=async(form,fn)=>{const button=form.querySelector('button');button.disabled=true;try{await fn();}catch(e){status.textContent=e.message;}finally{button.disabled=false;form.querySelectorAll('input[type=password]').forEach(x=>x.value='');}};
    document.getElementById('profileForm').onsubmit=e=>{e.preventDefault();submit(e.currentTarget,async()=>{
      const result=await this.api('/api/auth/profile',{method:'POST',body:{username:document.getElementById('profileUsername').value,displayName:document.getElementById('profileName').value}});
      this.user=result.user;status.textContent='Profil enregistré.';
    });};
    document.getElementById('passwordForm').onsubmit=e=>{e.preventDefault();submit(e.currentTarget,async()=>{
      if(!await this.beforeLogout())return;
      const result=await this.api('/api/auth/password',{method:'POST',body:{currentPassword:document.getElementById('currentPassword').value,password:document.getElementById('newPassword').value}});
      this.reset(result.message);this.channel?.postMessage('changed');
    });};
    const logout=async(all)=>{try{
      if(!await this.beforeLogout())return;
      await this.api('/api/auth/'+(all?'logout-all':'logout'),{method:'POST',body:{}});
      this.reset('Tu es déconnecté.');this.channel?.postMessage('changed');
    }catch(e){status.textContent='Déconnexion non confirmée : '+e.message;}};
    document.getElementById('logout').onclick=()=>logout(false);
    document.getElementById('logoutAll').onclick=()=>logout(true);
  }
}
