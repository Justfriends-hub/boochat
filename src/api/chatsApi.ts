import { getState, setState, uid, type Chat } from "@/lib/mockStore";
import { publish, subscribe } from "@/lib/eventBus";

export async function listChats(userId: string): Promise<Chat[]> {
  return getState().chats
    .filter((c) => c.memberIds.includes(userId))
    .sort((a, b) => {
      const am = a.lastMessageId ? getState().messages.find((m) => m.id === a.lastMessageId)?.createdAt ?? a.createdAt : a.createdAt;
      const bm = b.lastMessageId ? getState().messages.find((m) => m.id === b.lastMessageId)?.createdAt ?? b.createdAt : b.createdAt;
      return bm - am;
    });
}

export async function getChat(id: string): Promise<Chat | undefined> {
  return getState().chats.find((c) => c.id === id);
}

export async function getOrCreateDM(userA: string, userB: string): Promise<Chat> {
  const existing = getState().chats.find(
    (c) => c.type === "dm" && c.memberIds.includes(userA) && c.memberIds.includes(userB),
  );
  if (existing) return existing;
  const chat: Chat = {
    id: uid(), type: "dm", memberIds: [userA, userB], createdAt: Date.now(),
  };
  setState((s) => { s.chats.push(chat); });
  publish("chats:changed");
  return chat;
}

export async function createGroup(input: {
  name: string; memberIds: string[]; ownerId: string; avatar?: string;
}): Promise<Chat> {
  const chat: Chat = {
    id: uid(), type: "group",
    name: input.name,
    avatar: input.avatar || `https://api.dicebear.com/7.x/shapes/svg?seed=${encodeURIComponent(input.name)}`,
    memberIds: Array.from(new Set([input.ownerId, ...input.memberIds])),
    ownerId: input.ownerId,
    admins: [input.ownerId],
    permissions: { onlyAdminsPost: false, onlyAdminsAdd: false },
    createdAt: Date.now(),
  };
  setState((s) => { s.chats.push(chat); });
  publish("chats:changed");
  return chat;
}

export async function updateChat(id: string, patch: Partial<Chat>) {
  setState((s) => {
    const c = s.chats.find((x) => x.id === id);
    if (c) Object.assign(c, patch);
  });
  publish("chats:changed");
  publish(`chat:${id}`);
}

export async function leaveGroup(chatId: string, userId: string) {
  setState((s) => {
    const c = s.chats.find((x) => x.id === chatId);
    if (c) c.memberIds = c.memberIds.filter((x) => x !== userId);
  });
  publish("chats:changed");
}

export function subscribeToChats(cb: () => void) {
  return subscribe("chats:changed", cb);
}
