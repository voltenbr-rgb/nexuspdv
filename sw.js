// Service worker do Nexus PDV: abre o caixa mesmo sem internet.
const CACHE = "nexuspdv-v2";
const APP_SHELL = ["/", "/index.html", "/styles.css", "/app.js", "/db.js", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  // Rede primeiro (sempre a versão mais nova, sem misturar arquivos antigos e novos);
  // sem internet, usa a cópia salva para o caixa continuar abrindo.
  event.respondWith(
    fetch(req).then((res) => {
      if (res.ok) {
        const copy = res.clone();
        const key = req.mode === "navigate" ? "/index.html" : req;
        caches.open(CACHE).then((c) => c.put(key, copy));
      }
      return res;
    }).catch(() => caches.match(req.mode === "navigate" ? "/index.html" : req, { ignoreSearch: req.mode === "navigate" }))
  );
});
