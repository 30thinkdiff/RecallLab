import { createHash } from 'node:crypto';
import type { Plugin } from 'vite';
// Cache only public build files. IndexedDB and private uploads never enter this cache.
export function offlineShell(): Plugin {
  return {
    name: 'recalllab-offline-shell',
    enforce: 'post',
    generateBundle(_, bundle) {
      const files = Object.keys(bundle)
        .filter((f) => f === 'index.html' || /^assets\/.*\.(?:js|mjs|css)$/.test(f))
        .sort();
      if (!files.includes('index.html'))
        throw new Error('Offline shell is missing the generated index');
      const version = createHash('sha256').update(files.join('\n')).digest('hex').slice(0, 16);
      const source = `const CACHE='RecallLab-shell-${version}';
const FILES=${JSON.stringify(files)};
const url=(path)=>new URL(path,self.registration.scope).href;
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES.map(url)))));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
 for(const name of await caches.keys()) if(name.startsWith('RecallLab-shell-')&&name!==CACHE) await caches.delete(name);
 await self.clients.claim();
})()));
self.addEventListener('fetch',event=>{
 const request=event.request, parsed=new URL(request.url);
 if(request.method!=='GET'||parsed.origin!==self.location.origin) return;
 const scope=new URL(self.registration.scope).pathname;
 if(!parsed.pathname.startsWith(scope)) return;
 const path=parsed.pathname.slice(scope.length);
 if(request.mode==='navigate') {
  event.respondWith(fetch(request).catch(()=>caches.open(CACHE).then(cache=>cache.match(url('index.html')))));
 } else if(FILES.includes(path)||/^(pdf-assets|ocr-assets)\\//.test(path)) {
  event.respondWith((async()=>{
   const cache=await caches.open(CACHE),saved=await cache.match(request,{ignoreVary:true});
   if(saved)return saved;
   const response=await fetch(request);
   if(response.ok) { try { await cache.put(request,response.clone()); } catch { /* Optional cache quota must not block the readable response. */ } }
   return response;
  })());
 }
});`;
      this.emitFile({ type: 'asset', fileName: 'service-worker.js', source });
    },
  };
}
