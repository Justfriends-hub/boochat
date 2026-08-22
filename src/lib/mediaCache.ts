/**
 * mediaCache — device-local replay cache for viewed media
 *
 * Problem: Supabase Storage serves media through signed URLs whose token
 * rotates every session, so the HTTP cache misses on every reload and users
 * re-download the same image/audio/video over mobile data.
 *
 * Solution: fetch each asset once, store the bytes in the Cache Storage API
 * under a STABLE key (the storage path, which never changes), and serve every
 * later view as a local blob: URL — zero network, works fully offline.
 *
 * Used for chat images, voice messages, and status/story media.
 */

const CACHE_NAME = "boochat-media-v1";

/** Cap on stored entries; oldest-inserted are evicted (approximate LRU). */
const MAX_ENTRIES = 500;

/** Synthetic origin used purely as a cache key namespace — never fetched. */
const KEY_ORIGIN = "https://boochat.media/__key__/";

/** Session memo: stableKey → object URL already handed out this page load. */
const sessionUrls = new Map<string, string>();

function keyRequest(stableKey: string): Request {
  return new Request(KEY_ORIGIN + encodeURIComponent(stableKey));
}

async function openCache(): Promise<Cache | null> {
  try {
    if (typeof caches === "undefined") return null;
    return await caches.open(CACHE_NAME);
  } catch {
    return null;
  }
}

/**
 * Returns a blob URL for previously-viewed media, or null on cache miss.
 */
export async function getCachedMediaObjectUrl(stableKey: string): Promise<string | null> {
  if (!stableKey || /^(blob:|data:|https?:\/\/)/i.test(stableKey)) return null;
  const memo = sessionUrls.get(stableKey);
  if (memo) return memo;

  const cache = await openCache();
  if (!cache) return null;
  try {
    const hit = await cache.match(keyRequest(stableKey));
    if (!hit) return null;
    const blob = await hit.blob();
    const url = URL.createObjectURL(blob);
    sessionUrls.set(stableKey, url);
    return url;
  } catch {
    return null;
  }
}

/**
 * Downloads media once, stores it under the stable key, and returns a local
 * blob URL for immediate display. Falls back to the network URL if caching
 * is unavailable (private mode, quota, etc.) so rendering never breaks.
 */
export async function fetchAndCacheMedia(signedUrl: string, stableKey: string): Promise<string> {
  const memo = sessionUrls.get(stableKey);
  if (memo) return memo;

  const cache = await openCache();
  if (!cache) return signedUrl;

  try {
    // no-store: bypass HTTP cache because signed URLs rotate anyway
    const response = await fetch(signedUrl, { cache: "no-store" });
    if (!response.ok) return signedUrl;

    const key = keyRequest(stableKey);
    try {
      await cache.put(key, response.clone());
      void pruneMediaCache();
    } catch {
      // quota exceeded etc — still return the live URL
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    sessionUrls.set(stableKey, url);
    return url;
  } catch {
    return signedUrl;
  }
}

/**
 * Resolve-or-download helper used by list endpoints:
 *   1. session memo → instant
 *   2. disk cache → local blob URL (zero network)
 *   3. otherwise → download once via getSignedUrl(), cache, display locally
 */
export async function resolveMedia(
  getSignedUrl: () => Promise<string>,
  stableKey?: string | null,
): Promise<string> {
  if (!stableKey || /^(blob:|data:|https?:\/\/)/i.test(stableKey)) {
    return getSignedUrl();
  }
  const cached = await getCachedMediaObjectUrl(stableKey);
  if (cached) return cached;
  const signedUrl = await getSignedUrl();
  if (!signedUrl) return signedUrl;
  return fetchAndCacheMedia(signedUrl, stableKey);
}

/**
 * Fire-and-forget storage of an already-resolved signed URL (used when a user
 * views a story so the next open replays from the device).
 */
export async function primeMediaCache(signedUrl: string | undefined, stableKey?: string | null): Promise<void> {
  if (!signedUrl || !stableKey) return;
  if (/^data:/i.test(signedUrl)) return;
  if (sessionUrls.has(stableKey)) return;
  const cache = await openCache();
  if (!cache) return;
  try {
    const existing = await cache.match(keyRequest(stableKey));
    if (existing) {
      // Already stored — just warm the session memo for this load
      const blob = await existing.blob();
      sessionUrls.set(stableKey, URL.createObjectURL(blob));
      return;
    }
    const response = await fetch(signedUrl, { cache: "no-store" });
    if (response.ok) {
      await cache.put(keyRequest(stableKey), response.clone());
      void pruneMediaCache();
    }
  } catch {
    // best-effort only
  }
}

/** Keeps total stored media bounded by evicting oldest-inserted entries. */
export async function pruneMediaCache(maxEntries: number = MAX_ENTRIES): Promise<void> {
  try {
    const cache = await openCache();
    if (!cache) return;
    const keys = await cache.keys();
    if (keys.length <= maxEntries) return;
    // keys() returns insertion order in implementations we target
    const excess = keys.length - maxEntries;
    await Promise.all(keys.slice(0, excess).map((req) => cache.delete(req)));
  } catch {
    // ignore
  }
}
