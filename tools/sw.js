/* Song Builder service worker — scope /tools/ */
const CACHE = 'song-builder-v20261028c';
const PRECACHE = [
  './app/',
  './app/index.html',
  './app/app.js?v=20261028a',
  './app/app.css?v=20261028a',
  './app/manifest.webmanifest',
  './app/icons/icon-192.png',
  './app/icons/icon-512.png',
  './app/icons/icon-maskable-512.png',
  './ih-session.js?v=20261028a',
  './harmonic-landscape/',
  './harmonic-landscape/index.html',
  './fretboard/',
  './fretboard/index.html',
  './fretboard/fb-mobile.css?v=20261028f',
  './fretboard/fb-mobile.js?v=20261028f',
  './harmonic-landscape/css/hl-mobile.css?v=20261028b',
  './harmonic-landscape/js/hl-mobile.js?v=20261028b',
  './harmonic-landscape/js/hl-map-bridge.js?v=20261028a'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      Promise.all(
        PRECACHE.map((u) =>
          cache.add(u).catch(() => cache.add(u.split('?')[0]).catch(() => null))
        )
      )
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

function isHtml(req) {
  const accept = req.headers.get('accept') || '';
  if (accept.indexOf('text/html') >= 0) return true;
  try {
    const u = new URL(req.url);
    return u.pathname.endsWith('/') || u.pathname.endsWith('.html');
  } catch (_) {
    return false;
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  let url;
  try {
    url = new URL(req.url);
  } catch (_) {
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith('/tools/')) return;

  if (isHtml(req)) {
    // Network-first for HTML
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() =>
          caches.match(req).then((hit) => hit || caches.match('./app/index.html'))
        )
    );
    return;
  }

  // Cache-first for assets
  event.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      });
    })
  );
});
