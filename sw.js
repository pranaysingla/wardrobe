/* =========================================================================
   sw.js — makes Add to Home Screen produce a real app.

   The shell is cache-first, so the app opens instantly with no signal.
   outfits.json is the one exception: it is stale-while-revalidate, because
   the whole reason for GitHub Pages is that you can edit that file from the
   phone. Cache-first would mean an edit never arrived. You still get the
   cached copy instantly; the new one lands in the cache and the page offers
   a reload.

   Bump VERSION to force every client onto new assets.
   ========================================================================= */

const VERSION = 'v1';
const SHELL = `wardrobe-shell-${VERSION}`;
const FONTS = `wardrobe-fonts-${VERSION}`;
const KEEP = new Set([SHELL, FONTS]);

const SHELL_FILES = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './scheduler.js',
  './outfits.json',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
];

const FONT_ORIGINS = new Set(['https://fonts.googleapis.com', 'https://fonts.gstatic.com']);

/* ---------- lifecycle --------------------------------------------------- */
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    await cache.addAll(SHELL_FILES);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    const stale = names.filter((n) => !KEEP.has(n));
    await Promise.all(stale.map((n) => caches.delete(n)));
    await self.clients.claim();

    // Clearing out an older shell means this was an upgrade, not a first run.
    if (stale.some((n) => n.startsWith('wardrobe-shell-'))) {
      await notifyClients({ type: 'app-updated' });
    }
  })());
});

/* ---------- helpers ----------------------------------------------------- */
async function notifyClients(message) {
  const clients = await self.clients.matchAll({ type: 'window' });
  for (const client of clients) client.postMessage(message);
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request, { ignoreSearch: true });
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok || response.type === 'opaque') await cache.put(request, response.clone());
    return response;
  } catch (err) {
    const fallback = await cache.match(request, { ignoreSearch: true });
    if (fallback) return fallback;
    throw err;
  }
}

/* Serve the cached copy now, fetch a fresh one for next time, and say so if
   the contents actually changed. */
function staleWhileRevalidate(event) {
  event.respondWith((async () => {
    const cache = await caches.open(SHELL);
    const cached = await cache.match(event.request, { ignoreSearch: true });
    // Clone before the cached response is handed back, or the body is gone.
    const previous = cached ? await cached.clone().text() : null;

    const revalidating = (async () => {
      try {
        const response = await fetch(event.request, { cache: 'no-cache' });
        if (!response.ok) return null;
        const fresh = await response.clone().text();
        await cache.put(event.request, response.clone());
        if (previous !== null && previous !== fresh) {
          await notifyClients({ type: 'outfits-updated' });
        }
        return response;
      } catch {
        return null;
      }
    })();

    if (cached) {
      event.waitUntil(revalidating);
      return cached;
    }
    const fresh = await revalidating;
    if (fresh) return fresh;
    return Response.error();
  })());
}

/* ---------- routing ----------------------------------------------------- */
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  if (FONT_ORIGINS.has(url.origin)) {
    event.respondWith(cacheFirst(request, FONTS));
    return;
  }
  if (url.origin !== self.location.origin) return;

  if (url.pathname.endsWith('/outfits.json')) {
    staleWhileRevalidate(event);
    return;
  }

  /* Navigations are cache-first too — that is what makes the app open in one
     frame with no signal. New code arrives via a VERSION bump: the browser
     revalidates sw.js itself outside this cache. */
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL);
      const cached = await cache.match('./index.html', { ignoreSearch: true })
                  || await cache.match('./', { ignoreSearch: true });
      if (cached) return cached;
      try {
        return await fetch(request);
      } catch {
        return Response.error();
      }
    })());
    return;
  }

  event.respondWith(cacheFirst(request, SHELL));
});
