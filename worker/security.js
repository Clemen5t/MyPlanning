export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), { status, headers: {
    'Content-Type':'application/json; charset=UTF-8', 'Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'no-referrer', ...extra
  } });
}
export const now = () => Math.floor(Date.now()/1000);
export function randomToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), b=>b.toString(16).padStart(2,'0')).join('');
}
export async function hash(value) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
}
export async function readJson(request, limit = 16384) {
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) throw new HttpError(415,'Format JSON requis.');
  if (Number(request.headers.get('Content-Length')) > limit) throw new HttpError(413,'Envoi trop volumineux.');
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400,'Données manquantes.');
  let size = 0; const chunks = [];
  while (true) {
    const {done,value} = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel(); throw new HttpError(413,'Envoi trop volumineux.'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset=0;
  for (const chunk of chunks) { bytes.set(chunk,offset); offset+=chunk.length; }
  try { const body=JSON.parse(new TextDecoder().decode(bytes)); if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error(); return body; }
  catch { throw new HttpError(400,'JSON invalide.'); }
}
export function checkOrigin(request) {
  // No cross-site cookie auth: the app and API are served by this Worker.
  const origin = new URL(request.url).origin;
  if (request.headers.get('Origin') !== origin || request.headers.get('Sec-Fetch-Site') === 'cross-site') throw new HttpError(403,'Origine non autorisée.');
}
export async function rateLimit(env, key, max, seconds) {
  const expires = now()+seconds;
  const row = await env.DB.prepare(`INSERT INTO rate_limits(key,count,expires_at) VALUES (?,1,?)
    ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires_at<=? THEN 1 ELSE count+1 END,
    expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END RETURNING count`)
    .bind(await hash(key),expires,now(),now()).first();
  if (row.count > max) throw new HttpError(429,'Trop de tentatives. Réessaie dans quelques minutes.');
}
export function ip(request) { return request.headers.get('CF-Connecting-IP') || 'local'; }
