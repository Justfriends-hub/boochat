/**
 * Meshly Service Worker — Offline-first PWA
 *
 * Strategy:
 *   • Navigation requests    → NetworkFirst (try network, fall back to shell)
 *   • Hashed JS/CSS/fonts    → CacheFirst (assets never change once hashed)
 *   • Images & media         → StaleWhileRevalidate (show cached, refresh in bg)
 *   • Supabase / API calls   → NetworkOnly (never cache live data in SW)
 *
 * Cache versioning: bump SHELL_CACHE when you want to force-evict old caches.
 */
const SHELL_CACHE = "meshly-shell-v3";
const ASSET_CACHE = "meshly-assets-v3";
const IMAGE_CACHE = "meshly-images-v1";

const APP_SHELL = ["/", "/manifest.webmanifest"];

// ── Install: pre-cache the app shell ──────────────────────────────────────
self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((c) => c.addAll(APP_SHELL))
      .catch(() => {})
      .then(() => self.skipWaiting()),
  );
});

// ── Activate: clean up old caches ─────────────────────────────────────────
self.addEventListener("activate", (e) => {
  const valid = new Set([SHELL_CACHE, ASSET_CACHE, IMAGE_CACHE]);
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !valid.has(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// ── Message: allow clients to trigger skipWaiting ─────────────────────────
self.addEventListener("message", (e) => {
  if (e.data?.type === "SKIP_WAITING") self.skipWaiting();
});

// ── Fetch: route-based caching strategy ───────────────────────────────────
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Never intercept Supabase, analytics, or third-party API calls
  if (
    url.hostname.includes("supabase.co") ||
    url.hostname.includes("dicebear.com") ||
    url.origin !== self.location.origin
  ) {
    return;
  }

  // ── 1. Hashed static assets (JS, CSS, fonts) → CacheFirst ────────────
  if (/\.(js|css|woff2?|ttf|otf)(\?.*)?$/.test(url.pathname) && url.pathname.includes("assets")) {
    event.respondWith(
      caches.open(ASSET_CACHE).then(async (cache) => {
        const cached = await cache.match(req);
        if (cached) return cached;
        const response = await fetch(req);
        if (response.ok) cache.put(req, response.clone()).catch(() => {});
        return response;
      }),
    );
    return;
  }

  // ── 2. Images / icons → StaleWhileRevalidate ─────────────────────────
  if (/\.(png|jpg|jpeg|svg|webp|ico|gif)(\?.*)?$/.test(url.pathname)) {
    event.respondWith(
      caches.open(IMAGE_CACHE).then(async (cache) => {
        const cached = await cache.match(req);
        // Revalidate in the background
        const fetchPromise = fetch(req)
          .then((res) => {
            if (res.ok) cache.put(req, res.clone()).catch(() => {});
            return res;
          })
          .catch(() => cached);
        return cached ?? fetchPromise;
      }),
    );
    return;
  }

  // ── 3. Navigation (page loads) → NetworkFirst with shell fallback ─────
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            caches.open(SHELL_CACHE).then((c) => c.put(req, res.clone())).catch(() => {});
          }
          return res;
        })
        .catch(async () => {
          const cached = await caches.match(req);
          if (cached) return cached;
          // Fall back to the app shell so the SPA can handle routing
          return caches.match("/") ?? Response.error();
        }),
    );
    return;
  }
});
