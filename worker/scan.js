import { HttpError, json, readJson, rateLimit, ip } from './security.js';
export async function scan(request, env, session) {
  await rateLimit(env, 'scan-user:'+session.id, 10, 3600);
  await rateLimit(env, 'scan-ip:'+ip(request), 30, 3600);
  if(!env.GROQ_API_KEY) throw new HttpError(503,'Le scanner IA n’est pas configuré.');
  const body=await readJson(request, 12001000);
  const employee=typeof body.employee==='string'?body.employee.trim():'';
  if(!employee||employee.length>100) throw new HttpError(400,'Nom du salarié manquant ou trop long.');
  let image=body.image;
  if(typeof image!=='string'||!image) throw new HttpError(400,'Image manquante.');
  if(!image.startsWith('data:')) image='data:image/jpeg;base64,'+image;
  if(image.length>12000000) throw new HttpError(413,'Image trop volumineuse.');
  if(!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(image)) throw new HttpError(400,'Image invalide (JPEG, PNG ou WebP requis).');
      const prompt=`Analyse cette photo d'un planning de travail. Recherche UNIQUEMENT le salarié "${employee.replace(/[\r\n"]/g," ")}". Comprends visuellement le tableau et les colonnes lundi à dimanche. Ne prends jamais les horaires d'un autre salarié et n'invente jamais une valeur illisible. Une journée peut contenir plusieurs créneaux. Retourne uniquement un JSON valide avec exactement cette structure: {"employee_requested":"...","employee_found":null,"confidence":0,"days":[{"day":"monday","date":null,"shifts":[]},{"day":"tuesday","date":null,"shifts":[]},{"day":"wednesday","date":null,"shifts":[]},{"day":"thursday","date":null,"shifts":[]},{"day":"friday","date":null,"shifts":[]},{"day":"saturday","date":null,"shifts":[]},{"day":"sunday","date":null,"shifts":[]}],"warnings":[]}. Chaque shift est {"start":"HH:MM","end":"HH:MM"}. confidence est un entier 0-100. Si le salarié n'est pas identifié avec certitude, employee_found=null et n'utilise aucun horaire d'une autre ligne. Ignore les totaux.`;
  const model=env.GROQ_MODEL||'qwen/qwen3.8-27b';
  let response;
  try {
    response=await fetch('https://api.groq.com/openai/v1/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${env.GROQ_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({model,temperature:0,max_completion_tokens:1800,response_format:{type:'json_object'},messages:[{role:'user',content:[{type:'text',text:prompt},{type:'image_url',image_url:{url:image}}]}]}),signal:AbortSignal.timeout(40000)});
  } catch { throw new HttpError(504,'Le scanner IA met trop de temps à répondre. Réessaie.'); }
  if(!response.ok) throw new HttpError(502,'Groq est momentanément indisponible. Réessaie.');
  const data=await response.json().catch(()=>null);
  let planning;
  try { planning=JSON.parse(data.choices[0].message.content); } catch { throw new HttpError(502,'Réponse Vision invalide.'); }
  if(!planning || !Array.isArray(planning.days)) throw new HttpError(502,'Structure de planning invalide.');
  return json({ok:true,engine:'groq',model,planning});
}
