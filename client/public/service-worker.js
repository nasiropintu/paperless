const CACHE_NAME = "paperless-shell-v2";
const APP_ROOT = new URL("./", self.registration.scope);
const SHELL_URLS = ["", "manifest.webmanifest", "brand-mark.svg", "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png"].map((path) => new URL(path, APP_ROOT).href);

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_URLS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith("paperless-") && key !== CACHE_NAME).map((key) => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(APP_ROOT.pathname) || url.pathname.includes("/api/") || url.pathname.includes("/manus-storage/")) return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).then((response) => {
      if (!response.ok) return response;
      return caches.open(CACHE_NAME).then((cache) => cache.put(APP_ROOT.href, response.clone()).then(() => response));
    }).catch(async () => (await caches.match(APP_ROOT.href)) || Response.error()));
    return;
  }

  const shouldCache = url.pathname.includes("/assets/") || url.pathname.includes("/vendor/") || url.pathname.includes("/tessdata/") || SHELL_URLS.includes(url.href);
  if (shouldCache) {
    event.respondWith(caches.match(request).then((cached) => {
      const refresh = fetch(request).then((response) => {
        if (!response.ok) return response;
        return caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()).then(() => response));
      }).catch(() => cached || Response.error());
      return cached || refresh;
    }));
  }
});
