export default {
  async fetch(request, env) {
    const cors = {
      "Access-Control-Allow-Origin": "https://clemen5t.github.io",
      "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
      "Access-Control-Allow-Headers": "Content-Type",
      "Content-Type": "application/json; charset=UTF-8"
    };
    if (request.method === "OPTIONS") return new Response(null,{status:204,headers:cors});
    const url=new URL(request.url);
    if(request.method==="GET"&&url.pathname==="/health") return reply({ok:true,service:"MyPlanning AI",version:"0.1",vision:"Groq"},200,cors);
    if(request.method!=="POST"||url.pathname!=="/scan") return reply({ok:false,error:"Route inconnue"},404,cors);
    if(!env.GROQ_API_KEY) return reply({ok:false,error:"GROQ_API_KEY absente du Worker"},500,cors);
    try{
      const body=await request.json();
      const employee=String(body.employee||"").trim();
      if(!body.image) return reply({ok:false,error:"Image manquante"},400,cors);
      if(!employee) return reply({ok:false,error:"Nom du salarié manquant"},400,cors);
      let image=String(body.image);
      if(!image.startsWith("data:image/")) image="data:image/jpeg;base64,"+image;
      if(image.length>12000000) return reply({ok:false,error:"Image trop volumineuse"},413,cors);
      const prompt=`Analyse cette photo d'un planning de travail. Recherche UNIQUEMENT le salarié "${employee.replace(/[\r\n"]/g," ")}". Comprends visuellement le tableau et les colonnes lundi à dimanche. Ne prends jamais les horaires d'un autre salarié et n'invente jamais une valeur illisible. Une journée peut contenir plusieurs créneaux. Retourne uniquement un JSON valide avec exactement cette structure: {"employee_requested":"...","employee_found":null,"confidence":0,"days":[{"day":"monday","date":null,"shifts":[]},{"day":"tuesday","date":null,"shifts":[]},{"day":"wednesday","date":null,"shifts":[]},{"day":"thursday","date":null,"shifts":[]},{"day":"friday","date":null,"shifts":[]},{"day":"saturday","date":null,"shifts":[]},{"day":"sunday","date":null,"shifts":[]}],"warnings":[]}. Chaque shift est {"start":"HH:MM","end":"HH:MM"}. confidence est un entier 0-100. Si le salarié n'est pas identifié avec certitude, employee_found=null et n'utilise aucun horaire d'une autre ligne. Ignore les totaux.`;
      const r=await fetch("https://api.groq.com/openai/v1/chat/completions",{method:"POST",headers:{Authorization:`Bearer ${env.GROQ_API_KEY}`,"Content-Type":"application/json"},body:JSON.stringify({model:"qwen/qwen3.8-27b",temperature:0,max_completion_tokens:1800,response_format:{type:"json_object"},messages:[{role:"user",content:[{type:"text",text:prompt},{type:"image_url",image_url:{url:image}}]}]})});
      const data=await r.json();
      if(!r.ok) return reply({ok:false,error:"Erreur Groq",status:r.status,details:data?.error?.message||"Erreur inconnue"},502,cors);
      const raw=data?.choices?.[0]?.message?.content;
      if(!raw) return reply({ok:false,error:"Groq n'a renvoyé aucun résultat"},502,cors);
      let planning; try{planning=JSON.parse(raw)}catch(e){return reply({ok:false,error:"Réponse Vision invalide"},502,cors)}
      if(!Array.isArray(planning.days)) return reply({ok:false,error:"Structure de planning invalide"},502,cors);
      return reply({ok:true,engine:"groq",model:"qwen/qwen3.8-27b",planning},200,cors);
    }catch(e){return reply({ok:false,error:"Erreur serveur",details:String(e?.message||e)},500,cors)}
  }
};
function reply(data,status,headers){return new Response(JSON.stringify(data),{status,headers})}
