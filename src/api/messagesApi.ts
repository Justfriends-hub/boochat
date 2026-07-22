import { ensureSupabase } from "@/lib/supabaseClient";
import type { Message, MessageKind } from "@/lib/mockStore";
import {
  getCachedMessages,
  setCachedMessages,
  saveLocalMessage,
  addToOutbox,
  getOutbox,
  removeFromOutbox,
} from "@/lib/offlineStore";
import { publish } from "@/lib/eventBus";

function mapMessage(row: any): Message {
  const createdAt = new Date(row.created_at).getTime();
  return {
    id: row.id,
    chatId: row.chat_id,
    senderId: row.sender_id,
    kind: row.kind,
    body: row.body || "",
    duration: row.duration ?? undefined,
    createdAt,
    editedAt: row.edited_at ? new Date(row.edited_at).getTime() : undefined,
    deletedAt: row.deleted_at ? new Date(row.deleted_at).getTime() : undefined,
    replyTo: row.reply_to ?? undefined,
    forwardedFrom: row.forwarded_from ?? undefined,
    status: "sent",
  };
}

function handleSupabaseError(error: any, context: string): Error {
  if (error?.message?.includes("policy")) {
    return new Error(
      `⚠️ RLS Policy Error: ${context}\n\nYour Supabase RLS policies may be blocking this operation.\n\nSee: https://supabase.com/docs/guides/auth/row-level-security`
    );
  }
  return new Error(error?.message || context);
}

// Fetch messages with instant offline cache fallback
export async function listMessages(chatId: string): Promise<Message[]> {
  const cached = getCachedMessages(chatId);

  // Background fetch to refresh local cache
  if (typeof window !== "undefined" && navigator.onLine) {
    try {
      const supabase = ensureSupabase();
      const { data, error } = await supabase
        .from("messages")
        .select("*")
        .eq("chat_id", chatId)
        .order("created_at", { ascending: true });

      if (!error && data) {
        const remoteMsgs = data.map(mapMessage);
        setCachedMessages(chatId, remoteMsgs);
        return getCachedMessages(chatId);
      }
    } catch (err) {
      console.warn("Network fetch failed, serving from offline cache:", err);
    }
  }

  return cached;
}

// Optimistic & Offline-first Message Dispatch
export async function sendMessage(input: {
  chatId: string;
  senderId: string;
  kind: MessageKind;
  body: string;
  duration?: number;
  replyTo?: string;
  forwardedFrom?: string;
}): Promise<Message> {
  const tempId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const pendingMsg: Message = {
    id: tempId,
    chatId: input.chatId,
    senderId: input.senderId,
    kind: input.kind,
    body: input.body,
    duration: input.duration,
    replyTo: input.replyTo,
    forwardedFrom: input.forwardedFrom,
    createdAt: Date.now(),
    status: "pending",
  };

  // 1. Immediately store locally and render in UI (0ms delay)
  saveLocalMessage(pendingMsg);
  publish(`chat:${input.chatId}`);

  // 2. If offline, queue in outbox and return pending message
  if (typeof window !== "undefined" && !navigator.onLine) {
    addToOutbox(pendingMsg);
    return pendingMsg;
  }

  // 3. Send to Supabase
  try {
    const supabase = ensureSupabase();
    const insert = {
      chat_id: input.chatId,
      sender_id: input.senderId,
      kind: input.kind,
      body: input.body,
      duration: input.duration,
      reply_to: input.replyTo,
      forwarded_from: input.forwardedFrom,
    };

    const { data, error } = await supabase
      .from("messages")
      .insert([insert])
      .select()
      .single();

    if (error || !data) {
      // If network/RLS error occurs, queue in outbox for retry
      addToOutbox(pendingMsg);
      return pendingMsg;
    }

    const sentMsg = mapMessage(data);
    
    // Replace pending message with confirmed sent message
    saveLocalMessage(sentMsg);
    removeFromOutbox(tempId);
    
    await supabase.from("chats").update({ updated_at: new Date().toISOString() }).eq("id", input.chatId);
    publish(`chat:${input.chatId}`);
    return sentMsg;
  } catch (err) {
    console.warn("Failed to send message online, queued in outbox:", err);
    addToOutbox(pendingMsg);
    return pendingMsg;
  }
}

// Background sync for queued outbox messages when network reconnects
export async function syncPendingMessages() {
  if (typeof window === "undefined" || !navigator.onLine) return;
  const outbox = getOutbox();
  if (!outbox.length) return;

  const supabase = ensureSupabase();

  for (const pendingMsg of outbox) {
    try {
      const insert = {
        chat_id: pendingMsg.chatId,
        sender_id: pendingMsg.senderId,
        kind: pendingMsg.kind,
        body: pendingMsg.body,
        duration: pendingMsg.duration,
        reply_to: pendingMsg.replyTo,
        forwarded_from: pendingMsg.forwardedFrom,
      };

      const { data, error } = await supabase
        .from("messages")
        .insert([insert])
        .select()
        .single();

      if (!error && data) {
        const sentMsg = mapMessage(data);
        saveLocalMessage(sentMsg);
        removeFromOutbox(pendingMsg.id);
        publish(`chat:${pendingMsg.chatId}`);
      }
    } catch (err) {
      console.warn("Failed syncing pending message:", err);
    }
  }
}

// Auto-register online sync listener
if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    syncPendingMessages();
  });
  // Trigger initial sync attempt on startup
  setTimeout(() => syncPendingMessages(), 1000);
}

export async function editMessage(id: string, body: string) {
  const supabase = ensureSupabase();
  const { error } = await supabase
    .from("messages")
    .update({ body, edited_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteMessage(id: string) {
  const supabase = ensureSupabase();
  const { error } = await supabase
    .from("messages")
    .update({ deleted_at: new Date().toISOString(), body: "" })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function forwardMessage(id: string, toChatId: string, senderId: string) {
  const supabase = ensureSupabase();
  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .eq("id", id)
    .single();
  if (error || !data) return;

  return sendMessage({
    chatId: toChatId,
    senderId,
    kind: data.kind,
    body: data.body,
    forwardedFrom: data.sender_id,
  });
}

export async function markChatRead(chatId: string, userId: string) {
  if (typeof window !== "undefined" && !navigator.onLine) return;
  try {
    const supabase = ensureSupabase();
    const { error } = await supabase.rpc("mark_messages_read", { _chat_id: chatId });
    if (error) console.warn("mark_messages_read error:", error.message);
  } catch {}
}

export function subscribeToChat(chatId: string, cb: () => void) {
  if (typeof window !== "undefined" && !navigator.onLine) return () => undefined;
  try {
    const supabase = ensureSupabase();
    const channel = supabase.channel(`chat:${chatId}`);
    channel.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "messages", filter: `chat_id=eq.${chatId}` },
      () => cb(),
    );
    channel.subscribe();
    return () => channel.unsubscribe();
  } catch {
    return () => undefined;
  }
}

export function subscribeToTyping(_chatId: string, _cb: (p: { userId: string; typing: boolean }) => void) {
  return () => undefined;
}
