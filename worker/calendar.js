import { HttpError, json, now, randomToken, hash } from './security.js';
import { validatePlanning } from '../validation.js';

const TOKEN_RE=/^[a-f0-9]{64}$/;
const FEED_RE=/^\/calendar\/([a-f0-9]{64})\.ics$/;
const TYPE_LABELS={work:'Travail',rest:'Repos',leave:'Congé',sick:'Arrêt',training:'Formation'};

function icsEscape(value){
  return String(value??'')
    .replace(/\\/g,'\\\\')
    .replace(/\r?\n/g,'\\n')
    .replace(/;/g,'\\;')
    .replace(/,/g,'\\,');
}
function compactDate(date){return String(date).replaceAll('-','');}
function compactTime(time){return String(time).replace(':','')+'00';}
function minutes(time){const [h,m]=String(time).split(':').map(Number);return h*60+m;}
function nextDate(date){
  const d=new Date(date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+1);return d.toISOString().slice(0,10);
}
function stamp(seconds){
  return new Date(Number(seconds||now())*1000).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');
}
function response404(){
  return new Response('Calendrier introuvable.',{status:404,headers:{'Content-Type':'text/plain; charset=UTF-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
}

async function buildIcs(row){
  let planning;
  try{planning=validatePlanning(JSON.parse(row.data));}
  catch{throw new HttpError(500,'Planning invalide.');}
  const revision=Number(row.revision)||0,lastModified=stamp(row.updated_at),uidPrefix=(await hash(row.user_id)).slice(0,20);
  const lines=[
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//MyPlanning//Planning personnel//FR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:MyPlanning',
    'X-WR-TIMEZONE:Europe/Paris',
    'REFRESH-INTERVAL;VALUE=DURATION:PT15M',
    'X-PUBLISHED-TTL:PT15M',
    'BEGIN:VTIMEZONE',
    'TZID:Europe/Paris',
    'X-LIC-LOCATION:Europe/Paris',
    'BEGIN:DAYLIGHT',
    'TZOFFSETFROM:+0100',
    'TZOFFSETTO:+0200',
    'TZNAME:CEST',
    'DTSTART:19700329T020000',
    'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
    'END:DAYLIGHT',
    'BEGIN:STANDARD',
    'TZOFFSETFROM:+0200',
    'TZOFFSETTO:+0100',
    'TZNAME:CET',
    'DTSTART:19701025T030000',
    'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
    'END:STANDARD',
    'END:VTIMEZONE'
  ];

  for(const entry of planning.entries){
    if(entry.type==='work'){
      for(let i=0;i<entry.segments.length;i++){
        const seg=entry.segments[i],endDate=minutes(seg.end)<minutes(seg.start)?nextDate(entry.date):entry.date;
        const description=[entry.note||'',seg.breakMinutes?('Pause : '+seg.breakMinutes+' min'):''].filter(Boolean).join('\n');
        lines.push(
          'BEGIN:VEVENT',
          'UID:'+uidPrefix+'-'+compactDate(entry.date)+'-'+icsEscape(seg.id||String(i))+'@myplanning',
          'DTSTAMP:'+lastModified,
          'LAST-MODIFIED:'+lastModified,
          'SEQUENCE:'+revision,
          'DTSTART;TZID=Europe/Paris:'+compactDate(entry.date)+'T'+compactTime(seg.start),
          'DTEND;TZID=Europe/Paris:'+compactDate(endDate)+'T'+compactTime(seg.end),
          'SUMMARY:'+icsEscape('Travail'),
          ...(description?['DESCRIPTION:'+icsEscape(description)]:[]),
          'STATUS:CONFIRMED',
          'TRANSP:OPAQUE',
          'END:VEVENT'
        );
      }
    }else{
      lines.push(
        'BEGIN:VEVENT',
        'UID:'+uidPrefix+'-'+compactDate(entry.date)+'-'+entry.type+'@myplanning',
        'DTSTAMP:'+lastModified,
        'LAST-MODIFIED:'+lastModified,
        'SEQUENCE:'+revision,
        'DTSTART;VALUE=DATE:'+compactDate(entry.date),
        'DTEND;VALUE=DATE:'+compactDate(nextDate(entry.date)),
        'SUMMARY:'+icsEscape(TYPE_LABELS[entry.type]||entry.type),
        ...(entry.note?['DESCRIPTION:'+icsEscape(entry.note)]:[]),
        'STATUS:CONFIRMED',
        'TRANSP:TRANSPARENT',
        'END:VEVENT'
      );
    }
  }
  lines.push('END:VCALENDAR','');
  return lines.join('\r\n');
}

export async function calendarApi(request,env,path,session){
  if(path==='/api/calendar/status'&&request.method==='GET'){
    const row=await env.DB.prepare('SELECT 1 AS active FROM calendar_feeds WHERE user_id=?').bind(session.id).first();
    return json({ok:true,active:!!row});
  }
  if(path==='/api/calendar/create'&&request.method==='POST'){
    const token=randomToken(),tokenHash=await hash(token),created=now();
    await env.DB.prepare(`INSERT INTO calendar_feeds(user_id,token_hash,created_at,updated_at) VALUES (?,?,?,?)
      ON CONFLICT(user_id) DO UPDATE SET token_hash=excluded.token_hash,updated_at=excluded.updated_at`)
      .bind(session.id,tokenHash,created,created).run();
    const origin=new URL(request.url).origin,httpsUrl=origin+'/calendar/'+token+'.ics';
    return json({ok:true,active:true,httpsUrl,webcalUrl:httpsUrl.replace(/^https:/,'webcal:')});
  }
  if(path==='/api/calendar/revoke'&&request.method==='POST'){
    await env.DB.prepare('DELETE FROM calendar_feeds WHERE user_id=?').bind(session.id).run();
    return json({ok:true,active:false});
  }
  throw new HttpError(404,'Route calendrier inconnue.');
}

export async function serveCalendar(request,env,path){
  if(!['GET','HEAD'].includes(request.method))return new Response('Méthode non autorisée.',{status:405,headers:{Allow:'GET, HEAD'}});
  const match=path.match(FEED_RE);if(!match||!TOKEN_RE.test(match[1]))return response404();
  const tokenHash=await hash(match[1]);
  const row=await env.DB.prepare(`SELECT f.user_id,p.data,p.revision,p.updated_at
    FROM calendar_feeds f JOIN plannings p ON p.user_id=f.user_id WHERE f.token_hash=?`).bind(tokenHash).first();
  if(!row)return response404();
  const body=await buildIcs(row);
  return new Response(request.method==='HEAD'?null:body,{status:200,headers:{
    'Content-Type':'text/calendar; charset=UTF-8',
    'Content-Disposition':'inline; filename="MyPlanning.ics"',
    'Cache-Control':'private, max-age=300',
    'X-Content-Type-Options':'nosniff',
    'Referrer-Policy':'no-referrer'
  }});
}
