const CACHE='mcf-v4-shell-v1';
const APP=['/','/index.html','/manifest.webmanifest'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(c=>c.addAll(APP)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('fetch',event=>{
  const r=event.request;
  if(r.method!=='GET' || new URL(r.url).origin!==location.origin) return;
  event.respondWith(fetch(r).then(res=>{const copy=res.clone();caches.open(CACHE).then(c=>c.put(r,copy));return res}).catch(()=>caches.match(r).then(x=>x||caches.match('/index.html'))));
});
