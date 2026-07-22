// Offline-first local storage cache & outbox queue manager
import type { Message, Chat } from "./mockStore";

const CACHE_MESSAGES_KEY = "meshly.cache.messages.v1";
const OUTBOX_KEY = "meshly.outbox.v1";

type CachedMessagesMap = Record<string, Message[]>; // chatId -> messages

// Reads all cached messages from localStorage
export function getCachedMessages(chatId: string): Message[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(CACHE_MESSAGES_KEY);
    if (!raw) return [];
    const map: CachedMessagesMap = JSON.parse(raw);
    return map[chatId] || [];
  } catch {
    return [];
  }
}

// Saves/merges messages for a specific chat into localStorage
export function setCachedMessages(chatId: string, messages: Message[]) {
  if (typeof window === "undefined") return;
  try {
    const raw = localStorage.getItem(CACHE_MESSAGES_KEY);
    const map: CachedMessagesMap = raw ? JSON.parse(raw) : {};
    
    // Merge existing pending/local messages with fresh remote messages
    const existing = map[chatId] || [];
    const pendingMsgs = existing.filter((m) => m.status === "pending");
    
    // Combine remote messages + pending outbox messages without duplicates
    const combinedMap = new Map<string, Message>();
    messages.forEach((m) => combinedMap.set(m.id, m));
    pendingMsgs.forEach((m) => {
      if (!combinedMap.has(m.id)) combinedMap.set(m.id, m);
    });

    const finalMsgs = Array.from(combinedMap.values()).sort((a, b) => a.createdAt - b.createdAt);
    map[chatId] = finalMsgs;
    localStorage.setItem(CACHE_MESSAGES_KEY, JSON.stringify(map));
  } catch (err) {
    console.warn("Failed to write to local offline storage:", err);
  }
}

// Save a single message locally (e.g. pending message)
export function saveLocalMessage(msg: Message) {
  if (typeof window === "undefined") return;
  try {
    const raw = localStorage.getItem(CACHE_MESSAGES_KEY);
    const map: CachedMessagesMap = raw ? JSON.parse(raw) : {};
    const chatMsgs = map[msg.chatId] || [];
    
    const idx = chatMsgs.findIndex((m) => m.id === msg.id);
    if (idx >= 0) {
      chatMsgs[idx] = msg;
    } else {
      chatMsgs.push(msg);
    }
    map[msg.chatId] = chatMsgs.sort((a, b) => a.createdAt - b.createdAt);
    localStorage.setItem(CACHE_MESSAGES_KEY, JSON.stringify(map));
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
    return raw ? JSON.parse(raw) : [];
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
