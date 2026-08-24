/**
 * Meshly Service Worker — Offline-first PWA
 *
 * Strategy:
 *   • App install            → precache shell ("/", manifest) + every entry
 *                              asset referenced by the shell HTML (JS/CSS)
 *   • Navigation requests    → CACHE-FIRST with background refresh: the app
 *                              opens instantly from the device even with zero
 *                              connectivity; a fresh shell is downloaded
 *                              silently for the next load.
 *   • Hashed JS/CSS/fonts    → CacheFirst (assets never change once hashed)
 *   • Images & media         → StaleWhileRevalidate (show cached, refresh bg)
 *   • Supabase / API calls   → NetworkOnly (never intercepted; signed media
 *                              URLs are handled by the app's own media cache)
 *
 * Cache versioning: bump SHELL_CACHE / ASSET_CACHE together to force-evict.
 */
const SHELL_CACHE = "meshly-shell-v5";
const ASSET_CACHE = "meshly-assets-v5";
const IMAGE_CACHE = "meshly-images-v1";

const APP_SHELL = ["/", "/manifest.webmanifest"];

/**
 * Full list of hashed build assets, injected by scripts/build-sw.mjs at the
 * end of `npm run build`. Precaching ALL of them at install means every
 * route works offline immediately — no blank screens on first offline start.
 */
const PRECACHE_ASSETS = ["__PRECACHE_MANIFEST__"];

// ── Install: pre-cache the shell + entry assets ───────────────────────────
self.addEventListener("install", (e) => {
  e.waitUntil(precacheShellAndEntryAssets().then(() => self.skipWaiting()));
});

/**
 * Caches the SPA shell, then parses the served HTML for its hashed entry
 * chunks (/assets/*.js|css) and precaches those too — so the first offline
 * start doesn't need the network for the core bundle.
 */
async function precacheShellAndEntryAssets() {
  try {
    const shellCache = await caches.open(SHELL_CACHE);
    await shellCache.addAll(APP_SHELL).catch(() => {});

    // Precache the entire build manifest (every route chunk, in batches)
    if (Array.isArray(PRECACHE_ASSETS) && PRECACHE_ASSETS.length > 0) {
      const assetCache = await caches.open(ASSET_CACHE);
      const BATCH = 8;
      for (let i = 0; i < PRECACHE_ASSETS.length; i += BATCH) {
        await Promise.all(
          PRECACHE_ASSETS.slice(i, i + BATCH).map((u) =>
            assetCache.add(new Request(u, { cache: "reload" })).catch(() => {}),
          ),
        );
      }
    }
  } catch {
    // best-effort — runtime caching covers whatever we missed
  }
}

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

// ── Push: background notifications (WhatsApp-style, app closed) ──────────
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    try { data = { body: event.data ? event.data.text() : "" }; } catch { data = {}; }
  }
  const title = data.title || "boochat";
  const body = data.body || "New message";
  const url = data.url || "/chats";
  const tag = data.tag || data.chatId || "boochat-push";
  const icon = data.icon || "/icons/icon-192.png";
  const badge = data.badge || "/icons/icon-192.png";
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon,
      badge,
      tag,
      renotify: false,
      requireInteraction: false,
      data: { url, chatId: data.chatId },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/chats";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        // Focus existing window at target route if already open
        if (client.url.includes(new URL(url, self.location.origin).pathname) && "focus" in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(url);
    }),
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

  // ── 3. Navigation (page loads) → CACHE-FIRST + background refresh ────
  // The shell is canonical: every SPA route renders from the same document,
  // so we persist it under "/" and fall back to it for deep links.
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        const cache = await caches.open(SHELL_CACHE);
        const cached =
          (await cache.match("/")) ||
          (await cache.match(req, { ignoreSearch: true }));

        const networkUpdate = fetch(req)
          .then((res) => {
            if (res && res.ok) {
              // Canonical shell + per-path SSR HTML (so an offline reload of a
              // deep link hydrates against ITS OWN markup — no mismatch)
              cache.put("/", res.clone()).catch(() => {});
              try {
                const p = new URL(req.url).pathname;
                if (p !== "/") cache.put(p, res.clone()).catch(() => {});
              } catch {}
            }
            return res;
          })
          .catch(() => null);

        if (cached) {
          event.waitUntil(networkUpdate);
          return cached;
        }

        const fresh = await networkUpdate;
        return fresh || (await cache.match("/")) || Response.error();
      })(),
    );
    return;
  }
});
