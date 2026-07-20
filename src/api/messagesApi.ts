import { getState, setState, uid, type Message, type MessageKind } from "@/lib/mockStore";
import { publish, subscribe } from "@/lib/eventBus";

export async function listMessages(chatId: string): Promise<Message[]> {
  return getState().messages
    .filter((m) => m.chatId === chatId)
    .sort((a, b) => a.createdAt - b.createdAt);
}

export async function sendMessage(input: {
  chatId: string; senderId: string; kind: MessageKind; body: string;
  duration?: number; replyTo?: string; forwardedFrom?: string;
}): Promise<Message> {
  const msg: Message = {
    id: uid(),
    chatId: input.chatId,
    senderId: input.senderId,
    kind: input.kind,
    body: input.body,
    duration: input.duration,
    replyTo: input.replyTo,
    forwardedFrom: input.forwardedFrom,
    createdAt: Date.now(),
    status: "sent",
  };
  setState((s) => {
    s.messages.push(msg);
    const c = s.chats.find((x) => x.id === input.chatId);
    if (c) c.lastMessageId = msg.id;
  });
  publish(`chat:${input.chatId}`);
  publish("chats:changed");
  // Simulate delivered → read + auto reply for DMs
  setTimeout(() => markStatus(msg.id, "delivered"), 400);
  setTimeout(() => {
    markStatus(msg.id, "read");
    simulateReply(input.chatId, input.senderId);
  }, 1400);
  return msg;
}

function markStatus(id: string, status: Message["status"]) {
  setState((s) => {
    const m = s.messages.find((x) => x.id === id);
    if (m) m.status = status;
  });
  const m = getState().messages.find((x) => x.id === id);
  if (m) publish(`chat:${m.chatId}`);
}

function simulateReply(chatId: string, fromUserId: string) {
  const chat = getState().chats.find((c) => c.id === chatId);
  if (!chat || chat.type !== "dm") return;
  const otherId = chat.memberIds.find((u) => u !== fromUserId);
  if (!otherId) return;
  publish(`typing:${chatId}`, { userId: otherId, typing: true });
  setTimeout(() => {
    publish(`typing:${chatId}`, { userId: otherId, typing: false });
    const replies = ["Got it 👍", "Sounds good!", "Ok thanks", "I'll check and get back", "😄"];
    const body = replies[Math.floor(Math.random() * replies.length)];
    const reply: Message = {
      id: uid(), chatId, senderId: otherId, kind: "text", body,
      createdAt: Date.now(), status: "delivered",
    };
    setState((s) => {
      s.messages.push(reply);
      const c = s.chats.find((x) => x.id === chatId);
      if (c) c.lastMessageId = reply.id;
    });
    publish(`chat:${chatId}`);
    publish("chats:changed");
  }, 1500);
}

export async function editMessage(id: string, body: string) {
  setState((s) => {
    const m = s.messages.find((x) => x.id === id);
    if (m) { m.body = body; m.editedAt = Date.now(); }
  });
  const m = getState().messages.find((x) => x.id === id);
  if (m) publish(`chat:${m.chatId}`);
}

export async function deleteMessage(id: string) {
  const m = getState().messages.find((x) => x.id === id);
  setState((s) => {
    const mm = s.messages.find((x) => x.id === id);
    if (mm) { mm.deletedAt = Date.now(); mm.body = ""; }
  });
  if (m) publish(`chat:${m.chatId}`);
}

export async function forwardMessage(id: string, toChatId: string, senderId: string) {
  const m = getState().messages.find((x) => x.id === id);
  if (!m) return;
  return sendMessage({
    chatId: toChatId, senderId, kind: m.kind, body: m.body, forwardedFrom: m.senderId,
  });
}

export async function markChatRead(chatId: string, userId: string) {
  setState((s) => {
    s.messages.forEach((m) => {
      if (m.chatId === chatId && m.senderId !== userId && m.status !== "read") m.status = "read";
    });
  });
  publish(`chat:${chatId}`);
  publish("chats:changed");
}

export function subscribeToChat(chatId: string, cb: () => void) {
  return subscribe(`chat:${chatId}`, cb);
}
export function subscribeToTyping(chatId: string, cb: (p: { userId: string; typing: boolean }) => void) {
  return subscribe(`typing:${chatId}`, cb);
}
