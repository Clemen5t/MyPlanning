import { authRoute, getSession } from './auth.js';
import { scan } from './scan.js';
import { calendarApi, serveCalendar } from './calendar.js';
import { HttpError, json, checkOrigin, readJson, now, rateLimit } from './security.js';
import { validatePlanning } from '../validation.js';

export default {
  async fetch(request, env) {
    const path=new URL(request.url).pathname;
    if(path==='/health'&&request.method==='GET') return json({ok:true,service:'MyPlanning',version:'0.08',vision:'Groq',groq_secret:!!env.GROQ_API_KEY,auth_configured:!!env.DB});
    if(path.startsWith('/calendar/')) {
      try {
        if(!env.DB) throw new HttpError(503,'Service indisponible.');
        return await serveCalendar(request,env,path);
      } catch {
        return new Response('Erreur serveur.',{status:500,headers:{'Content-Type':'text/plain; charset=UTF-8','Cache-Control':'no-store'}});
      }
    }
    if(!path.startsWith('/api/')&&path!=='/scan') return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Not found',{status:404});
    try {
      if(!env.DB) throw new HttpError(503,'La base de comptes n’est pas encore configurée.');
      if(!['GET','HEAD'].includes(request.method)) checkOrigin(request);
      if(path.startsWith('/api/auth/')) return await authRoute(request,env,path);
      const session=await getSession(request,env);
      if(path.startsWith('/api/calendar/')) return await calendarApi(request,env,path,session);
      if((path==='/scan'||path==='/api/scan')&&request.method==='POST') return await scan(request,env,session);
      if(path==='/api/planning') {
        if(request.method==='GET') {
          const row=await env.DB.prepare('SELECT data,revision FROM plannings WHERE user_id=?').bind(session.id).first();
          return json({ok:true,data:JSON.parse(row.data),revision:row.revision});
        }
        if(request.method==='PUT') {
          await rateLimit(env,'write:'+session.id,120,60);
          const body=await readJson(request,2000000);
          if(!Number.isSafeInteger(body.revision)||body.revision<0) throw new HttpError(400,'Version du planning invalide.');
          let data; try { data=validatePlanning(body.data); } catch(e) { throw new HttpError(400,e.message); }
          const result=await env.DB.prepare('UPDATE plannings SET data=?,revision=revision+1,updated_at=? WHERE user_id=? AND revision=? RETURNING revision').bind(JSON.stringify(data),now(),session.id,body.revision).first();
          if(!result) throw new HttpError(409,'Le planning a été modifié sur un autre appareil. Recharge sa dernière version avant de continuer.');
          return json({ok:true,revision:result.revision});
        }
        throw new HttpError(405,'Méthode non autorisée.');
      }
      throw new HttpError(404,'Route inconnue.');
    } catch(error) {
      const status=error instanceof HttpError?error.status:500;
      return json({ok:false,error:status===500?'Erreur serveur. Réessaie.':error.message},status,{
        ...(status===429?{'Retry-After':'600'}:{})
      });
    }
  },
  async scheduled(_event, env) {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM sessions WHERE expires_at<=?').bind(now()),
      env.DB.prepare('DELETE FROM rate_limits WHERE expires_at<=?').bind(now())
    ]);
  }
};
