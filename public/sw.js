// Minimal app-shell service worker for DeliveryCheck. Cache-first, runtime-populated
// (Vite hashes asset filenames, so the JS/CSS get cached on first fetch rather than
// from a hardcoded list). This is an offline single-user tool — no network-first.
//
// To ship an app update, bump CACHE: the new SW's activate step drops old caches.

const CACHE = "dc-v1";
const SHELL = ["/", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png", "/apple-touch-icon.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;

  e.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req)
        .then((res) => {
          // Cache successful same-origin responses for next time.
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => {
          // Offline: fall back to the cached app shell for navigations (SPA — main.jsx
          // routes /harness from the same HTML at runtime).
          if (req.mode === "navigate") return caches.match("/");
          return Response.error();
        });
    })
  );
});
