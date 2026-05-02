// Increment this version string whenever you deploy new code.
// The browser detects the change, installs the new SW, and clears old caches.
const VERSION = '1.1.0';
const CACHE   = `jic-${VERSION}`;

// Activate immediately — don't wait for old tabs to close
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim()) // Take control of all open tabs now
  );
});

// Network-first: always fetch fresh from server.
// Only fall back to cache if the network is unreachable (true offline).
// Never cache API calls — only static pages.
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Skip API calls entirely — let them go straight to the network
  if (url.pathname.startsWith('/api/')) return;

  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Cache a fresh copy for offline fallback
        const copy = response.clone();
        caches.open(CACHE).then(cache => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
