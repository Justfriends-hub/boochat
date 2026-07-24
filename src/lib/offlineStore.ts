// Offline-first local storage cache & outbox queue manager
import type { Message } from "./mockStore";

const CACHE_MESSAGES_KEY_PREFIX = "meshly.cache.messages.v1";
const OUTBOX_KEY = "meshly.outbox.v1";
const MESSAGE_CACHE_LIMIT = 300;

function getCacheKey(chatId: string) {
  return `${CACHE_MESSAGES_KEY_PREFIX}.${chatId}`;
}

function capMessages(messages: Message[]) {
  const sorted = [...messages].sort((a, b) => a.createdAt - b.createdAt);
  return sorted.length > MESSAGE_CACHE_LIMIT ? sorted.slice(sorted.length - MESSAGE_CACHE_LIMIT) : sorted;
}

// Reads cached messages for a single chat from localStorage
export function getCachedMessages(chatId: string): Message[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(getCacheKey(chatId));
    return raw ? (JSON.parse(raw) as Message[]) : [];
  } catch {
    return [];
  }
}

// Saves/merges messages for a specific chat into localStorage
export function setCachedMessages(chatId: string, messages: Message[]) {
  if (typeof window === "undefined") return;
  try {
    const existing = getCachedMessages(chatId);
    const pendingMsgs = existing.filter((m) => m.status === "pending");

    const combinedMap = new Map<string, Message>();
    messages.forEach((m) => combinedMap.set(m.id, m));
    pendingMsgs.forEach((m) => {
      if (!combinedMap.has(m.id)) combinedMap.set(m.id, m);
    });

    localStorage.setItem(getCacheKey(chatId), JSON.stringify(capMessages(Array.from(combinedMap.values()))));
  } catch (err) {
    console.warn("Failed to write to local offline storage:", err);
  }
}

// Save a single message locally (e.g. pending message)
export function saveLocalMessage(msg: Message) {
  if (typeof window === "undefined") return;
  try {
    const chatMsgs = getCachedMessages(msg.chatId);
    const idx = chatMsgs.findIndex((m) => m.id === msg.id);

    if (idx >= 0) {
      chatMsgs[idx] = msg;
    } else {
      chatMsgs.push(msg);
    }

    localStorage.setItem(getCacheKey(msg.chatId), JSON.stringify(capMessages(chatMsgs)));
  } catch (err) {
    console.warn("Failed to save local message:", err);
  }
}

// Add a pending message payload to the offline outbox queue
export function addToOutbox(msg: Message) {
  if (typeof window === "undefined") return;
  try {
    const raw = localStorage.getItem(OUTBOX_KEY);
    const list: Message[] = raw ? JSON.parse(raw) : [];
    list.push(msg);
    localStorage.setItem(OUTBOX_KEY, JSON.stringify(list));
  } catch (err) {
    console.warn("Failed to queue outbox message:", err);
  }
}

// Get all queued outbox messages
export function getOutbox(): Message[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(OUTBOX_KEY);
    return raw ? (JSON.parse(raw) as Message[]) : [];
  } catch {
    return [];
  }
}

// Remove a message from the outbox after successful sync
export function removeFromOutbox(msgId: string) {
  if (typeof window === "undefined") return;
  try {
    const raw = localStorage.getItem(OUTBOX_KEY);
    if (!raw) return;
    const list: Message[] = JSON.parse(raw);
    const updated = list.filter((m) => m.id !== msgId);
    localStorage.setItem(OUTBOX_KEY, JSON.stringify(updated));
  } catch (err) {
    console.warn("Failed to update outbox:", err);
  }
}
