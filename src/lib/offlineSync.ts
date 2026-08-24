/**
 * offlineSync — Telegram/WhatsApp-style full offline warming
 *
 * After login (or on every online app boot), this module eagerly fetches
 * every list the user can view (chats, groups, channels, statuses, channel
 * posts, users) and primes the device media cache for every image/voice/video
 * they have ever seen. The goal: the next time the app opens in airplane
 * mode, everything the user has *watched* is instantly replayable from
 * IndexedDB + Cache Storage with zero network.
 *
 * Design:
 *  - Idempotent & throttled — warmAllCaches() no-ops if a warm is already in
 *    flight or just completed < 60s ago (unless forced).
 *  - Best-effort — each step is try/catch isolated so one failing endpoint
 *    doesn't block the rest.
 *  - Low priority — runs in idle time / with limited concurrency so it never
 *    blocks the UI thread.
 *  - Offline-aware — immediately returns when navigator.onLine === false.
 */

import { getState } from "./mockStore";
import { primeMediaCache, getCachedMediaObjectUrl } from "./mediaCache";

let warming = false;
let lastWarmAt = 0;
const WARM_THROTTLE_MS = 60_000;
const CONCURRENCY = 6;

function isOnline(): boolean {
  if (typeof window === "undefined") return false;
  return navigator.onLine;
}

async function idle(): Promise<void> {
  if (typeof window === "undefined") return;
  const w = window as unknown as {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
  };
  if (w.requestIdleCallback) {
    await new Promise<void>((res) => w.requestIdleCallback!(() => res(), { timeout: 2000 }));
  } else {
    await new Promise<void>((res) => setTimeout(res, 300));
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      try {
        results[i] = await fn(items[i]);
      } catch {
        // isolated
      }
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

async function primeChatMessageMedia() {
  try {
    const { getCachedMessages } = await import("./offlineStore");
    const { getImageUrl } = await import("./imageUpload");
    const chats = getState().chats;
    for (const chat of chats) {
      const msgs = getCachedMessages(chat.id);
      for (const m of msgs) {
        if ((m.kind === "image" || m.kind === "voice") && m.imagePath) {
          const cached = await getCachedMediaObjectUrl(m.imagePath);
          if (cached) continue;
          try {
            const signed = await getImageUrl("chat-media", m.imagePath);
            if (signed) await primeMediaCache(signed, m.imagePath);
          } catch {}
        } else if ((m.kind === "image" || m.kind === "voice") && m.body && /^https?:\/\//i.test(m.body) && m.imagePath) {
          // fallback path
          try {
            await primeMediaCache(m.body, m.imagePath);
          } catch {}
        }
      }
      // yield to main thread per chat
      await idle();
    }
  } catch {}
}

/**
 * Auto-download pass for messages received while the user was away:
 * listMessages() refreshes each chat's recent window (pulling any new rows),
 * and priming then stores every image/voice blob locally so airplane-mode
 * opens replay them instantly — WhatsApp "media auto-download" equivalent.
 */
async function syncAndPrimeAwayMessages() {
  try {
    const { listMessages } = await import("@/api/messagesApi");
    const chats = getState().chats;
    await mapWithConcurrency(chats, CONCURRENCY, async (c) => {
      try { await listMessages(c.id).catch(() => {}); } catch {}
    });
    await primeChatMessageMedia();
  } catch {}
}

/** Step 2+3 of the warm pipeline: sync windows, then prime all media kinds. */
async function syncAndPrimeMessagesAndMedia() {
  await syncAndPrimeAwayMessages();
  await idle();
  await primeAvatars();
  await primeChannelPostMedia();
  await primeStatusMedia();
}

async function primeChannelPostMedia() {
  try {
    const posts = getState().channelPosts;
    if (!posts.length) return;
    const { getImageUrl } = await import("./imageUpload");
    for (const p of posts) {
      if (p.image && !/^https?:\/\//i.test(p.image) && p.image) {
        // p.image may be a storage path when not yet resolved
        const cached = await getCachedMediaObjectUrl(p.image);
        if (cached) continue;
        try {
          const signed = await getImageUrl("channel-media", p.image);
          if (signed) await primeMediaCache(signed, p.image);
        } catch {}
      } else if (p.image && /^https?:\/\//i.test(p.image) && (p as unknown as { imagePath?: string }).imagePath) {
        // not needed
      }
      await idle();
    }
  } catch {}
}

async function primeStatusMedia() {
  try {
    const statuses = getState().statuses;
    for (const st of statuses) {
      if (st.storagePath || st.media) {
        const key = st.storagePath ?? st.media;
        if (!key || /^https?:\/\//i.test(key) && !st.storagePath) continue;
        const cached = await getCachedMediaObjectUrl(key);
        if (cached) continue;
        try {
          if (st.media && st.storagePath) {
            await primeMediaCache(st.media, st.storagePath);
          }
        } catch {}
      }
      await idle();
    }
  } catch {}
}

async function primeAvatars() {
  try {
    const users = getState().users;
    const { getImageUrl } = await import("./imageUpload");
    for (const u of users) {
      const raw = (u as unknown as { _avatarPath?: string })._avatarPath;
      if (!raw) continue;
      const cached = await getCachedMediaObjectUrl(raw);
      if (cached) continue;
      try {
        const signed = await getImageUrl("avatars", raw);
        if (signed) await primeMediaCache(signed, raw);
      } catch {}
      await idle();
    }
  } catch {}
}

/**
 * Warm all offline caches in the background. Call after successful login and
 * on every online boot. Throttled to once per 60s unless `force=true`.
 */
export async function warmAllCaches(opts: { force?: boolean; userId?: string } = {}): Promise<void> {
  if (!isOnline()) return;
  const now = Date.now();
  if (!opts.force && warming) return;
  if (!opts.force && now - lastWarmAt < WARM_THROTTLE_MS) return;

  warming = true;
  lastWarmAt = now;

  try {
    await idle();

    // 1) Ensure core lists are fully hydrated (these also persist to IndexedDB
    //    via their own saveList calls, so the next offline start has them).
    const userId = opts.userId ?? getState().users.find(() => true)?.id ?? getState().chats[0]?.memberIds[0];
    const tasks: Array<() => Promise<void>> = [];

    tasks.push(async () => {
      try {
        const { listUsers } = await import("@/api/usersApi");
        await listUsers().catch(() => {});
      } catch {}
    });

    tasks.push(async () => {
      try {
        if (userId) {
          const { listChats } = await import("@/api/chatsApi");
          await listChats(userId).catch(() => {});
        } else {
          const { listChats } = await import("@/api/chatsApi");
          // fallback: try with current auth user if available
          const { getCurrentUser } = await import("@/api/authApi");
          const me = getCurrentUser();
          if (me) await listChats(me.id).catch(() => {});
        }
      } catch {}
    });

    tasks.push(async () => {
      try {
        const { listChannels } = await import("@/api/channelsApi");
        await listChannels().catch(() => {});
      } catch {}
    });

    tasks.push(async () => {
      try {
        const { getCurrentUser } = await import("@/api/authApi");
        const me = getCurrentUser();
        const { listActiveStatuses } = await import("@/api/statusApi");
        await listActiveStatuses(me?.id).catch(() => {});
      } catch {}
    });

    tasks.push(async () => {
      try {
        const { listPosts } = await import("@/api/channelsApi");
        await listPosts().catch(() => {});
      } catch {}
    });

    await mapWithConcurrency(tasks, CONCURRENCY, (fn) => fn());

    await idle();

    // 2) For every chat, ensure its recent message window is cached locally.
    //    listMessages() writes to Dexie via setCachedMessages, so per-chat
    //    offline history survives airplane mode. Also auto-downloads media
    //    for anything that arrived while the user was away.
    await syncAndPrimeMessagesAndMedia();
  } finally {
    warming = false;
  }
}

/**
 * Hook to be called once at app boot (after initOfflineStore). It warms caches
 * in the background when online, without blocking the initial render.
 */
export function scheduleWarmAllCaches(userId?: string) {
  if (typeof window === "undefined") return;
  if (!isOnline()) return;
  const w = window as unknown as {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
  };
  const run = () => {
    void warmAllCaches({ userId }).catch(() => {});
  };
  if (w.requestIdleCallback) w.requestIdleCallback(run, { timeout: 5000 });
  else setTimeout(run, 2000);
}
