/* OC Hub service worker — makes the hub installable + opens instantly.
   Strategy: network-first for index.html (so git push updates show up right away),
   cache-first for assets (icons, sprites, backdrop). 🦄 */
const CACHE = "oc-hub-v1";
self.addEventListener("install", (e) => { self.skipWaiting(); });
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;   // Supabase + CDNs go straight to the network
  const isShell = url.pathname.endsWith("/") || url.pathname.endsWith("index.html");
  if (isShell) {
    /* network-first: never serve a stale app after a push */
    e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(CACHE).then(ca => ca.put(e.request, c)); return r; }).catch(() => caches.match(e.request)));
  } else {
    /* cache-first for images/scripts: instant loads on iPhone */
    e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(r => { const c = r.clone(); caches.open(CACHE).then(ca => ca.put(e.request, c)); return r; })));
  }
});
