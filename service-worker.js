/* AVT Check-in Produktiv v1.1.0 – bestehende PWA-Scope / URL unverändert */
const CACHE = "avt-checkin-prod-1.1.0";
const LOCAL_FILES = [
  "./", "index.html", "version.json", "help.html", "styles.css", "manifest.webmanifest",
  "js/config.js", "js/backend.js", "js/updater.js", "js/storage.js", "js/scanner.js",
  "js/app.js", "js/jsQR.js", "icons/icon-192.png", "icons/icon-512.png",
  "icons/header-logo.png", "icons/power-icon.png", "icons/refresh-icon.svg", "icons/help-icon.svg"
];
const JSQR_URL = "https://unpkg.com/jsqr@1.4.0/dist/jsQR.js";
self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(LOCAL_FILES);
    try {
      const response = await fetch(JSQR_URL, {mode:"cors"});
      if (response.ok) await cache.put(JSQR_URL, response.clone());
    } catch (_) {}
    await self.skipWaiting();
  })());
});
self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith("avt-checkin-prod-") && k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});
self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin && req.url !== JSQR_URL) return;
  // Versionsprüfung MUSS stets die Serverdatei abfragen, nicht die alte Cache-Fassung.
  if (url.origin === self.location.origin && url.pathname.endsWith("/version.json")) {
    event.respondWith(fetch(req, {cache:"no-store"}).catch(() => caches.match("version.json")));
    return;
  }
  event.respondWith((async () => {
    try { return await fetch(req); }
    catch (error) {
      const cache = await caches.open(CACHE);
      const matched = url.origin === self.location.origin
        ? await cache.match(req, {ignoreSearch:true})
        : await cache.match(req);
      return matched || Response.error();
    }
  })());
});
