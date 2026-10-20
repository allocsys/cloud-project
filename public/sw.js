// Opus service worker: makes the app installable and shows a friendly page when offline.
// Pages are network-first (always fresh when online); build assets and icons are cached.
const VERSION = 'opus-v1';
const STATIC = `${VERSION}-static`;
const PAGES = `${VERSION}-pages`;

const OFFLINE = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#12110d"><title>Offline</title>
<style>
html,body{margin:0;height:100%;background:#12110d;color:#ebe6da;font:400 14px/20px Roboto,system-ui,sans-serif}
body{display:grid;place-items:center;text-align:center;padding:24px}
.m{width:56px;height:56px;border-radius:16px;margin:0 auto 20px;display:grid;place-items:center;background:#4f3d0e;color:#ffdf9b;font-size:26px;font-weight:500}
h1{font-size:22px;line-height:28px;font-weight:400;margin:0 0 8px}
p{margin:0 0 24px;color:#aaa28f}
button{min-height:48px;padding:0 24px;border:0;border-radius:24px;background:#e9c46a;color:#3b2a00;font:500 14px Roboto,system-ui,sans-serif}
</style></head><body><div><div class="m">O</div>
<h1>You're offline</h1><p>Check your connection and try again.</p>
<button onclick="location.reload()">Retry</button></div></body></html>`;

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

// Pages: network first, so signed-in state is always right. If the network takes longer than SLOW and a saved copy
// exists, the saved copy is shown instead, so a weak connection never leaves the person staring at a blank screen.
const SLOW = 3000;

async function networkFirst(req) {
  try {
    const live = fetch(req).then((res) => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(PAGES).then((c) => c.put(req, copy));
      }
      return res;
    });
    const hit = await caches.match(req);
    if (!hit) return await live;
    live.catch(() => {});
    return await Promise.race([live, new Promise((r) => setTimeout(() => r(hit), SLOW))]);
  } catch (err) {
    const hit = await caches.match(req);
    return hit || new Response(OFFLINE, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(STATIC);
  const hit = await cache.match(req);
  const fresh = fetch(req)
    .then((res) => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    })
    .catch(() => hit);
  return hit || fresh;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/admin')) return;

  if (req.mode === 'navigate') {
    event.respondWith(networkFirst(req));
  } else if (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname === '/logo.svg' ||
    url.pathname === '/manifest.webmanifest'
  ) {
    event.respondWith(staleWhileRevalidate(req));
  }
});
