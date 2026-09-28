// Service worker. Compiled as a classic script (no imports/exports).

// Bump VERSION when shipping changes so clients drop the old cache.
const VERSION = 'gastos-v5';
const FILES = ['./', 'index.html', 'styles.css', 'app.js', 'lib.js', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png'];

const worker = self as unknown as ServiceWorkerGlobalScope;

worker.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => worker.skipWaiting()));
});

worker.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => worker.clients.claim()),
  );
});

// Network first (so updates land when online), cache fallback for offline.
worker.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== worker.location.origin) return;
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' })
      .then((res) => {
        const copy = res.clone();
        void caches.open(VERSION).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(async () =>
        (await caches.match(e.request, { ignoreSearch: true })) ??
        (await caches.match('index.html')) ??
        Response.error()),
  );
});
