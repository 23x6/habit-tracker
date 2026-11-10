/* Still service worker: precache app shell, serve cache-first, fall back to index for navigations. */
const CACHE = 'still-' + __VERSION__;
const PRECACHE = __PRECACHE__;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match('./', { ignoreSearch: true, ignoreVary: true }).then((r) => r || caches.match(req))));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true, ignoreVary: true }).then((r) => r || fetch(req)));
});
// Push reminders from the server (api/reminders.ts): { kind, title, body, url, tag }. Every push shows a
// notification (required by browsers; Safari revokes subscriptions that receive silent pushes).
self.addEventListener('push', (e) => {
  let d = {};
  try {
    d = e.data ? e.data.json() : {};
  } catch (_) {
    d = { body: e.data ? e.data.text() : '' };
  }
  e.waitUntil(
    self.registration.showNotification(d.title || 'RYVO', {
      body: d.body || '',
      tag: d.tag || undefined,
      icon: './icon-192.png',
      data: { url: d.url || './' },
    }),
  );
});

// Tapping a notification opens RYVO on the habit it is about (`?habit=<id>`): an open window is focused and
// told which habit to show; otherwise a new window starts with the URL.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href;
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
      const c = cs.find((x) => x.url.startsWith(self.registration.scope));
      if (c) {
        c.postMessage({ type: 'open', url });
        return c.focus();
      }
      return self.clients.openWindow(url);
    }),
  );
});
