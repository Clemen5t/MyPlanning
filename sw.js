// v0.07: remove old catch-all caches, never cache private API responses.
const CACHE='myplanning-v007-public';
const PUBLIC=['./icon.svg','./manifest.webmanifest'];
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(
  caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('myplanning-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())
));
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET') return;
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin||!PUBLIC.some(p=>new URL(p,self.registration.scope).pathname===url.pathname)) return;
  event.respondWith(fetch(event.request).then(response=>{
    if(response.ok) { const copy=response.clone(); event.waitUntil(caches.open(CACHE).then(c=>c.put(event.request,copy))); }
    return response;
  }).catch(()=>caches.match(event.request)));
});
