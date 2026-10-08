/*
 * ZABY TRACKER service worker.
 *
 * Two jobs, and deliberately no more: let the browser offer to install the app, and show something
 * sensible when the network drops. It caches only the files Next fingerprints and the offline page.
 *
 * It never caches an API response. Those carry one person's assets, employees and SIM lines, and a
 * shared phone or a signed-out session must not be able to read them back out of the cache.
 */
const VERSION = 'v1';
const STATIC = `zaby-static-${VERSION}`;
const OFFLINE_URL = '/offline';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(STATIC)
      .then((cache) => cache.addAll([OFFLINE_URL, '/icons/icon-192.png']))
      .then(() => self.skipWaiting())
      // A failed pre-cache must not leave the old worker stuck in place.
      .catch(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== STATIC).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Anything that carries a session goes straight to the network, every time.
  if (url.pathname.startsWith('/api')) return;

  // Fingerprinted files never change under the same name, so the cached copy is always right.
  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.open(STATIC).then(async (cache) => {
        const hit = await cache.match(request);
        if (hit) return hit;
        const response = await fetch(request);
        if (response.ok) cache.put(request, response.clone());
        return response;
      }),
    );
    return;
  }

  // Pages come from the network. Offline, say so in the app's own words.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(async () => (await caches.match(OFFLINE_URL)) ?? Response.error()),
    );
  }
});
