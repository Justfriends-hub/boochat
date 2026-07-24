/**
 * Offline-first local storage — Dexie/IndexedDB backend
 *
 * Architecture: two-layer cache
 *
 *   L1 (in-memory Map) — sync reads, instant, lives for the current page session
 *   L2 (Dexie/IndexedDB) — async persistence, survives page reloads
 *
 * All existing callers that read synchronously continue to work via the L1
 * map. Writes update L1 immediately and persist to L2 in the background
 * (fire-and-forget). On app startup call `initOfflineStore()` once to
 * pre-populate L1 from L2 so the cache is warm before any API calls fire.
 */
import type { Message } from "./mockStore";
import { db } from "./db";
import { publish } from "./eventBus";

const MESSAGE_CACHE_LIMIT = 300;

// ── L1: In-memory caches (sync reads) ─────────────────────────────────────
const msgCache = new Map<string, Message[]>();
const outboxCache: Message[] = [];
let storeInitialized = false;

function capMessages(msgs: Message[]): Message[] {
  const sorted = [...msgs].sort((a, b) => a.createdAt - b.createdAt);
  return sorted.length > MESSAGE_CACHE_LIMIT
    ? sorted.slice(sorted.length - MESSAGE_CACHE_LIMIT)
    : sorted;
}

// ── Initialization (call once in __root.tsx) ───────────────────────────────
/**
 * Loads all persisted messages and the outbox from IndexedDB into the L1
 * in-memory cache. After this resolves, all sync reads will hit warm data.
 */
export async function initOfflineStore(): Promise<void> {
  if (typeof window === "undefined") return;
  if (storeInitialized) return;
  storeInitialized = true;

  try {
    // Load all cached messages grouped by chatId
    const allMsgs = await db.messages.toArray();
    const byChat = new Map<string, Message[]>();
    for (const msg of allMsgs) {
      const list = byChat.get(msg.chatId) ?? [];
      list.push(msg);
      byChat.set(msg.chatId, list);
    }
    for (const [chatId, msgs] of byChat) {
      msgCache.set(chatId, capMessages(msgs));
    }

    // Load outbox
    const pendingMsgs = await db.outbox.toArray();
    outboxCache.length = 0;
    outboxCache.push(...pendingMsgs);

    publish("offlineStore:ready");
  } catch (err) {
    console.warn("[offlineStore] Failed to initialize from IndexedDB:", err);
  }
}

// ── Message cache ──────────────────────────────────────────────────────────

/** Sync read from L1 cache. Returns cached messages or [] if not yet loaded. */
export function getCachedMessages(chatId: string): Message[] {
  return msgCache.get(chatId) ?? [];
}

/** Merge remote messages into L1+L2. Preserves pending messages from outbox. */
export function setCachedMessages(chatId: string, messages: Message[]): void {
  // Keep any local-only pending messages that aren't in the remote list yet
  const existing = msgCache.get(chatId) ?? [];
  const pendingOnly = existing.filter(
    (m) => m.status === "pending" && !messages.find((r) => r.id === m.id),
  );

  const merged = capMessages([...messages, ...pendingOnly]);
  msgCache.set(chatId, merged);

  // Persist to IndexedDB in background
  db.messages
    .bulkPut(merged)
    .catch((err) => console.warn("[offlineStore] bulkPut failed:", err));
}

/** Upsert a single message into L1+L2 (used for pending & confirmed messages). */
export function saveLocalMessage(msg: Message): void {
  const list = msgCache.get(msg.chatId) ?? [];
  const idx = list.findIndex((m) => m.id === msg.id);
  if (idx >= 0) {
    list[idx] = msg;
  } else {
    list.push(msg);
  }
  msgCache.set(msg.chatId, capMessages(list));

  // Background persist
  db.messages
    .put(msg)
    .catch((err) => console.warn("[offlineStore] put failed:", err));
}

/** Remove a confirmed-sent message from the cache (replaces pending copy). */
export function removeLocalMessage(chatId: string, msgId: string): void {
  const list = msgCache.get(chatId) ?? [];
  const filtered = list.filter((m) => m.id !== msgId);
  msgCache.set(chatId, filtered);

  db.messages
    .delete(msgId)
    .catch((err) => console.warn("[offlineStore] delete failed:", err));
}

// ── Outbox queue ───────────────────────────────────────────────────────────

/** Add a pending message to the outbox (L1 + L2). */
export function addToOutbox(msg: Message): void {
  if (!outboxCache.find((m) => m.id === msg.id)) {
    outboxCache.push(msg);
  }
  db.outbox
    .put(msg)
    .catch((err) => console.warn("[offlineStore] outbox put failed:", err));
}

/** Sync read of the outbox queue. */
export function getOutbox(): Message[] {
  return [...outboxCache];
}

/** Remove a successfully synced message from the outbox (L1 + L2). */
export function removeFromOutbox(msgId: string): void {
  const idx = outboxCache.findIndex((m) => m.id === msgId);
  if (idx >= 0) outboxCache.splice(idx, 1);

  db.outbox
    .delete(msgId)
    .catch((err) => console.warn("[offlineStore] outbox delete failed:", err));
}

/** Count of messages currently queued in the outbox. */
export function getPendingCount(): number {
  return outboxCache.length;
}

// ── App state (last route, scroll, etc.) ──────────────────────────────────

/** Persist an arbitrary key/value to IndexedDB appState table. */
export async function setAppState(key: string, value: unknown): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    await db.appState.put({ key, value });
  } catch (err) {
    console.warn("[offlineStore] setAppState failed:", err);
  }
}

/** Read a value from IndexedDB appState table. Returns undefined if not found. */
export async function getAppState<T = unknown>(key: string): Promise<T | undefined> {
  if (typeof window === "undefined") return undefined;
  try {
    const row = await db.appState.get(key);
    return row?.value as T | undefined;
  } catch {
    return undefined;
  }
}
