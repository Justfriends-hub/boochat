import { ensureSupabase } from "@/lib/supabaseClient";
import type { Message, MessageKind } from "@/lib/mockStore";

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

export async function listMessages(chatId: string): Promise<Message[]> {
  const supabase = ensureSupabase();
  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .eq("chat_id", chatId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map(mapMessage);
}

export async function sendMessage(input: {
  chatId: string; senderId: string; kind: MessageKind; body: string;
  duration?: number; replyTo?: string; forwardedFrom?: string;
}): Promise<Message> {
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
  if (error || !data) throw new Error(error.message || "Failed to send message.");

  await supabase.from("chats").update({ updated_at: new Date().toISOString() }).eq("id", input.chatId);
  return mapMessage(data);
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
  const supabase = ensureSupabase();
  const { error } = await supabase.rpc("mark_messages_read", { _chat_id: chatId });
  if (error) throw new Error(error.message);
}

export function subscribeToChat(chatId: string, cb: () => void) {
  const supabase = ensureSupabase();
  const channel = supabase.channel(`chat:${chatId}`);
  channel.on(
    "postgres_changes",
    { event: "*", schema: "public", table: "messages", filter: `chat_id=eq.${chatId}` },
    () => cb(),
  );
  channel.subscribe();
  return () => channel.unsubscribe();
}

export function subscribeToTyping(_chatId: string, _cb: (p: { userId: string; typing: boolean }) => void) {
  return () => undefined;
}
