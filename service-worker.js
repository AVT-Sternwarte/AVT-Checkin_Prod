const CACHE = "avt-checkin-prod-1.0.0";
const LOCAL_FILES = [
  "./", "index.html", "help.html", "styles.css", "manifest.webmanifest",
  "js/config.js", "js/backend.js", "js/storage.js", "js/scanner.js",
  "js/app.js", "js/jsQR.js", "icons/icon-192.png", "icons/icon-512.png",
  "icons/header-logo.png", "icons/power-icon.png", "icons/refresh-icon.svg", "icons/help-icon.svg"
];
const JSQR_URL = "https://unpkg.com/jsqr@1.4.0/dist/jsQR.js";

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(LOCAL_FILES);
    try {
      const response = await fetch(JSQR_URL, { mode: "cors" });
      if (response.ok) await cache.put(JSQR_URL, response.clone());
    } catch {}
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;

  if (event.request.url === JSQR_URL) {
    event.respondWith((async () => {
      const cached = await caches.match(event.request);
      if (cached) return cached;
      const response = await fetch(event.request);
      if (response.ok) {
        const cache = await caches.open(CACHE);
        await cache.put(event.request, response.clone());
      }
      return response;
    })());
    return;
  }

  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
});
