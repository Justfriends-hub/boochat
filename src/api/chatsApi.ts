import { ensureSupabase } from "@/lib/supabaseClient";
import { publish } from "@/lib/eventBus";
import { getState, setState, hydrateLists, type Chat, type JoinRequest } from "@/lib/mockStore";
import { getOfflineList, getSavedList, saveList } from "@/lib/offlineStore";
import { resolveDisplayUrl } from "@/lib/mediaCache";
import { userAvatarFallback } from "@/lib/avatar";

function mapChat(chat: any, members: string[], group: any | null): Chat {
  const visibility = chat.visibility ?? (chat.is_public === false ? "private" : "public");
  const rawAvatar: string | undefined = chat.avatar_url ?? undefined;
  const base: Chat = {
    id: chat.id,
    type: chat.type,
    memberIds: members,
    createdAt: new Date(chat.created_at).getTime(),
    // Keep the RAW value here (storage path or full URL). Display copies are
    // resolved separately so the durable mirror never holds dead blob:/signed URLs.
    avatar: rawAvatar,
    name: chat.name ?? undefined,
    ownerId: group?.owner_id ?? undefined,
    admins: group?.admins ?? undefined,
    permissions: group ? {
      onlyAdminsPost: group.only_admins_post,
      onlyAdminsAdd: group.only_admins_add,
    } : undefined,
    visibility,
  };
  return base;
}

/**
 * Convert a cached chat's avatar into a LIVE display URL:
 * storage path → device cache blob; stale blob:/data: → deterministic
 * DiceBear fallback (group seed = chat id/name). Never renders blank offline.
 */
async function resolveChatAvatar(chat: Chat): Promise<Chat> {
  const avatar = await resolveDisplayUrl(chat.avatar, chat.id || chat.name);
  return { ...chat, avatar };
}

export async function rehydrateChatAvatars(chats: Chat[]): Promise<Chat[]> {
  return Promise.all(chats.map(resolveChatAvatar));
}

function handleSupabaseError(error: any, context: string): Error {
  if (error?.message?.includes("policy")) {
    return new Error(
      `⚠️ RLS Policy Error: ${context}\n\nYour Supabase RLS policies may be blocking this operation.\n\nPlease check:\n1. Row Level Security (RLS) is ENABLED on the tables\n2. Policies allow authenticated users to INSERT/SELECT\n3. Auth user is properly authenticated\n\nSee: https://supabase.com/docs/guides/auth/row-level-security`
    );
  }
  return new Error(error?.message || context);
}

function isVisibilitySchemaError(error: any) {
  const message = `${error?.message ?? ""} ${error?.details ?? ""}`.toLowerCase();
  return message.includes("column") && message.includes("does not exist");
}

async function fetchChatMembers(chatIds: string[]) {
  try {
    const supabase = ensureSupabase();
    const { data, error } = await supabase
      .from("chat_members")
      .select("chat_id,user_id")
      .in("chat_id", chatIds);

    if (error) {
      console.warn("Unable to fetch chat members:", error);
      return [];
    }
    return data ?? [];
  } catch (error) {
    console.warn("Unable to fetch chat members:", error);
    return [];
  }
}

export async function listChats(userId: string): Promise<Chat[]> {
  const filterByMember = (list: Chat[]) => list.filter((c) => c.memberIds.includes(userId));

  /**
   * Durable cache read. Order: memory → IndexedDB mirror (ALWAYS consulted
   * when memory misses the member, since memory may be a stale/partial
   * snapshot that shadows the mirror). Member filter is relaxed to an
   * unfiltered fallback — a mirror saved on this device is user-scoped
   * already, and strict filtering is what produced "no chats" false negatives.
   */
  const getCached = async (): Promise<{ list: Chat[]; durableOnly: boolean }> => {
    const mem = getState().chats;
    if (mem.length) {
      const f = filterByMember(mem);
      if (f.length) return { list: f, durableOnly: false };
    }
    // Read the mirror DIRECTLY (bypasses memory shadowing)
    const saved = await getSavedList<Chat>("chats");
    if (saved.length) {
      hydrateLists({ chats: saved });
      const f = filterByMember(saved);
      return { list: f.length ? f : saved, durableOnly: true };
    }
    return { list: mem.length ? filterByMember(mem).length ? filterByMember(mem) : mem : [], durableOnly: true };
  };

  // Offline: serve instantly from durable cache with live avatar URLs
  if (typeof window !== "undefined" && !navigator.onLine) {
    const { list } = await getCached();
    return rehydrateChatAvatars(list);
  }

  // Online cache-first: warm cache → instant paint + background refresh
  const cached = await getCached();
  const doBgRefresh = async () => {
    try {
      const supabase = ensureSupabase();
      const { data: membershipRows, error: membershipError } = await supabase
        .from("chat_members")
        .select("chat_id")
        .eq("user_id", userId);
      if (membershipError || !membershipRows) return;
      const chatIds = membershipRows.map((row) => row.chat_id);
      if (!chatIds.length) return;
      const { data: chats, error: chatError } = await supabase
        .from("chats")
        .select("*")
        .in("id", chatIds)
        .order("updated_at", { ascending: false });
      if (chatError || !chats) return;
      const memberRows = await fetchChatMembers(chatIds);
      const groupsData = await supabase.from("groups").select("*").in("chat_id", chatIds);
      const groups = groupsData.data ?? [];
      const remoteChats = chats.map((chatRow) => {
        const members = memberRows.filter((row) => row.chat_id === chatRow.id).map((row) => row.user_id);
        const group = groups.find((g) => g.chat_id === chatRow.id) ?? null;
        const cachedOne = getState().chats.find((c) => c.id === chatRow.id);
        const remoteChat = mapChat(chatRow, members, group);
        if (cachedOne?.visibility) remoteChat.visibility = cachedOne.visibility;
        return remoteChat;
      });
      setState((s) => { s.chats = remoteChats; });
      saveList("chats", remoteChats); // raw paths — durable
      publish("chats:changed");
    } catch (e) {
      console.warn("Background chat refresh failed:", e);
    }
  };

  if (cached.list.length) {
    void doBgRefresh();
    // Display copy gets resolved avatars; memory keeps raw for durability
    return rehydrateChatAvatars(cached.list);
  }

  // Cold start with no cache — await network
  try {
    const supabase = ensureSupabase();
    const { data: membershipRows, error: membershipError } = await supabase
      .from("chat_members")
      .select("chat_id")
      .eq("user_id", userId);
    if (!membershipError && membershipRows) {
      const chatIds = membershipRows.map((row) => row.chat_id);
      if (chatIds.length) {
        const { data: chats, error: chatError } = await supabase
          .from("chats")
          .select("*")
          .in("id", chatIds)
          .order("updated_at", { ascending: false });
        if (!chatError && chats) {
          const memberRows = await fetchChatMembers(chatIds);
          const groupsData = await supabase.from("groups").select("*").in("chat_id", chatIds);
          const groups = groupsData.data ?? [];
          const remoteChats = chats.map((chatRow) => {
            const members = memberRows.filter((row) => row.chat_id === chatRow.id).map((row) => row.user_id);
            const group = groups.find((g) => g.chat_id === chatRow.id) ?? null;
            const cachedOne = getState().chats.find((c) => c.id === chatRow.id);
            const remoteChat = mapChat(chatRow, members, group);
            if (cachedOne?.visibility) remoteChat.visibility = cachedOne.visibility;
            return remoteChat;
          });
          setState((s) => { s.chats = remoteChats; });
          saveList("chats", remoteChats);
          return rehydrateChatAvatars(remoteChats);
        }
      } else {
        return [];
      }
    }
  } catch (error) {
    console.warn("Unable to load remote chats, returning cached chats:", error);
  }
  return rehydrateChatAvatars(cached.list);
}

export async function getChat(id: string): Promise<Chat | undefined> {
  const findInMemory = () => getState().chats.find((c) => c.id === id);
  const findInMirror = async (): Promise<Chat | undefined> => {
    // DIRECT durable read — memory may be stale/partial and must not shadow it
    const saved = await getSavedList<Chat>("chats");
    if (saved.length) {
      const hit = saved.find((c) => c.id === id);
      if (hit) {
        // merge into memory so subsequent sync reads hit
        setState((s) => {
          if (!s.chats.some((c) => c.id === id)) s.chats.push(hit);
        });
        return hit;
      }
    }
    // last resort: the legacy hydrate path
    const local = await getOfflineList(
      () => getState().chats,
      "chats",
      (items) => hydrateLists({ chats: items }),
    );
    return local.find((c) => c.id === id);
  };

  if (typeof window !== "undefined" && !navigator.onLine) {
    const hit = findInMemory() ?? (await findInMirror());
    return hit ? resolveChatAvatar(hit) : undefined;
  }

  try {
    const supabase = ensureSupabase();
    const { data: chatRow, error: chatError } = await supabase
      .from("chats")
      .select("*")
      .eq("id", id)
      .single();
    if (!chatError && chatRow) {
      const { data: memberRows } = await supabase
        .from("chat_members")
        .select("user_id")
        .eq("chat_id", id);
      const members = (memberRows ?? []).map((row) => row.user_id);

      let group = null;
      if (chatRow.type === "group") {
        const { data: groupRow } = await supabase
          .from("groups")
          .select("*")
          .eq("chat_id", id)
          .single();
        group = groupRow ?? null;
      }
      const remoteChat = mapChat(chatRow, members, group);
      const cached = findInMemory();
      if (cached?.visibility) remoteChat.visibility = cached.visibility;
      setState((s) => {
        const idx = s.chats.findIndex((c) => c.id === id);
        if (idx >= 0) s.chats[idx] = remoteChat;
        else s.chats.push(remoteChat);
      });
      saveList("chats", getState().chats); // raw paths — durable
      return resolveChatAvatar(remoteChat);
    }
  } catch (error) {
    console.warn("Unable to load remote chat, returning cached chat:", error);
  }
  const hit = findInMemory() ?? (await findInMirror());
  return hit ? resolveChatAvatar(hit) : undefined;
}

export async function getOrCreateDM(userA: string, userB: string): Promise<Chat> {
  const supabase = ensureSupabase();

  const idA = userA.trim().toLowerCase();
  const idB = userB.trim().toLowerCase();
  if (idA === idB) {
    throw new Error("Cannot create a DM with yourself.");
  }

  const cachedDM = getState().chats.find(
    (c) =>
      c.type === "dm" &&
      c.memberIds.map((x) => x.trim().toLowerCase()).includes(idA) &&
      c.memberIds.map((x) => x.trim().toLowerCase()).includes(idB),
  );
  if (cachedDM) return cachedDM;

  const { data: newChat, error: createChatError } = await supabase
    .rpc("get_or_create_dm", { _user_a: userA, _user_b: userB })
    .single() as { data: any; error: any };

  if (createChatError || !newChat) {
    throw handleSupabaseError(createChatError, "Failed to open DM. Check RLS policies on chats/chat_members and RPC execution rights.");
  }

  const { data: memberRows, error: memberError } = await supabase
    .from("chat_members")
    .select("user_id")
    .eq("chat_id", newChat.id);

  if (memberError) {
    console.warn("getOrCreateDM: failed to load DM members:", memberError.message);
  }

  const members = Array.from(new Set((memberRows ?? []).map((row) => row.user_id)));
  const mapped = mapChat(newChat, members, null);

  setState((s) => {
    if (!s.chats.find((c) => c.id === mapped.id)) s.chats.push(mapped);
  });
  saveList("chats", getState().chats);
  publish("chats:changed");
  return mapped;
}

export async function createGroup(input: {
  name: string;
  memberIds: string[];
  ownerId: string;
  avatar?: string;
  visibility?: "public" | "private";
}): Promise<Chat> {
  const supabase = ensureSupabase();
  const visibility = input.visibility ?? "public";
  const { data: newChat, error: createChatError } = await supabase.rpc("create_chat", {
    _type: "group",
    _name: input.name,
    _avatar_url: input.avatar ?? null,
  });
  if (createChatError || !newChat) {
    throw handleSupabaseError(createChatError, "Failed to create group. Check RLS policies on the 'chats' table.");
  }

  const groupInsert: Record<string, any> = {
    chat_id: newChat.id,
    name: input.name,
    avatar_url: input.avatar,
    owner_id: input.ownerId,
  };

  const { data: groupRow, error: createGroupError } = await supabase
    .from("groups")
    .insert([groupInsert])
    .select()
    .single();
  if (createGroupError || !groupRow) {
    throw handleSupabaseError(createGroupError, "Failed to create group metadata. Check RLS policies on the 'groups' table.");
  }

  const members = Array.from(new Set([input.ownerId, ...input.memberIds]));
  const otherMembers = members.filter((userId) => userId !== input.ownerId);
  const memberRows = otherMembers.map((userId) => ({ chat_id: newChat.id, user_id: userId }));
  if (memberRows.length) {
    const { error: membershipError } = await supabase.from("chat_members").insert(memberRows);
    if (membershipError) {
      throw handleSupabaseError(membershipError, "Failed to add members to group. Check RLS policies on the 'chat_members' table.");
    }
  }

  // Persist immediately for offline-first: chat must survive cold offline reload
  setState((s) => {
    const mapped = mapChat(newChat, members, { ...groupRow, visibility });
    if (!s.chats.find((c) => c.id === mapped.id)) s.chats.push(mapped);
    else {
      const idx = s.chats.findIndex((c) => c.id === mapped.id);
      if (idx >= 0) s.chats[idx] = mapped;
    }
  });
  saveList("chats", getState().chats);
  publish("chats:changed");
  return mapChat(newChat, members, { ...groupRow, visibility });
}

export async function updateChat(id: string, patch: Partial<Chat>) {
  const supabase = ensureSupabase();
  // NOTE: `muted` is a per-user preference and the live schema has no such
  // column on `chats` — keep it in the local store only.
  if (patch.name !== undefined || patch.avatar !== undefined) {
    const update: Record<string, any> = {};
    if (patch.name !== undefined) update.name = patch.name;
    if (patch.avatar !== undefined) update.avatar_url = patch.avatar;
    const { error } = await supabase.from("chats").update(update).eq("id", id);
    if (error) throw new Error(error.message);
  }

  if (patch.ownerId !== undefined || patch.permissions !== undefined || patch.visibility !== undefined) {
    const groupUpdate: Record<string, any> = {};
    if (patch.ownerId !== undefined) groupUpdate.owner_id = patch.ownerId;
    if (patch.permissions !== undefined) {
      groupUpdate.only_admins_post = patch.permissions.onlyAdminsPost;
      groupUpdate.only_admins_add = patch.permissions.onlyAdminsAdd;
    }

    try {
      if (Object.keys(groupUpdate).length > 0) {
        const { error } = await supabase.from("groups").update(groupUpdate).eq("chat_id", id);
        if (error) throw error;
      }
    } catch (error: any) {
      throw new Error(error.message || "Unable to update group settings.");
    }

    if (patch.visibility !== undefined) {
      setState((s) => {
        const chat = s.chats.find((c) => c.id === id);
        if (chat) chat.visibility = patch.visibility;
      });
      saveList("chats", getState().chats);
    }
  }

  // Always mirror local-only fields so the UI reflects them immediately
  if (patch.muted !== undefined || patch.name !== undefined || patch.avatar !== undefined) {
    setState((s) => {
      const chat = s.chats.find((c) => c.id === id);
      if (!chat) return;
      if (patch.muted !== undefined) chat.muted = patch.muted;
    });
  }

  saveList("chats", getState().chats);
  publish("chats:changed");
  publish(`chat:${id}`);
}

export async function leaveGroup(chatId: string, userId: string) {
  const supabase = ensureSupabase();
  const { error: memberError } = await supabase
    .from("chat_members")
    .delete()
    .eq("chat_id", chatId)
    .eq("user_id", userId);
  if (memberError) throw new Error(memberError.message);

  const { data: groupRow, error: groupError } = await supabase
    .from("groups")
    .select("id")
    .eq("chat_id", chatId)
    .single();
  if (!groupError && groupRow) {
    await supabase
      .from("group_members")
      .delete()
      .eq("group_id", groupRow.id)
      .eq("user_id", userId);
  }

  setState((s) => {
    s.chats = s.chats.filter((c) => c.id !== chatId || c.type !== "group");
  });
  saveList("chats", getState().chats);
  publish("chats:changed");
}

export function subscribeToChats(cb: () => void) {
  // Shared-singleton realtime channel: every call site (chats list, groups
  // list, admin page…) registers a handler on ONE socket pair instead of each
  // opening its own subscription — fewer connections, less mobile battery.
  // Same pattern as subscribeToChannels in channelsApi.
  const globalKey = Symbol.for("boochat.chatRealtime.listeners");
  const globalState = ((globalThis as any)[globalKey] ?? {
    handlers: new Set<() => void>(),
    subscription: null,
  }) as {
    handlers: Set<() => void>;
    subscription: { unsubscribe: () => void } | null;
  };
  (globalThis as any)[globalKey] = globalState;

  globalState.handlers.add(cb);

  if (!globalState.subscription) {
    try {
      const supabase = ensureSupabase();
      const channel = supabase.channel("chats");
      const notify = () => {
        Array.from(globalState.handlers as Set<() => void>).forEach((handler) => handler());
      };
      channel.on("postgres_changes", { event: "*", schema: "public", table: "chats" }, notify);
      channel.on("postgres_changes", { event: "*", schema: "public", table: "chat_members" }, notify);
      channel.subscribe();
      globalState.subscription = channel;
    } catch (error) {
      console.warn("Unable to subscribe to chat updates:", error);
      return () => {
        globalState.handlers.delete(cb);
      };
    }
  }

  return () => {
    globalState.handlers.delete(cb);
    if (globalState.handlers.size === 0 && globalState.subscription) {
      try {
        globalState.subscription.unsubscribe();
      } catch (error) {
        console.warn("Failed to unsubscribe from chat realtime:", error);
      }
      globalState.subscription = null;
    }
  };
}

function ensureJoinRequestList(requests?: JoinRequest[]) {
  return requests?.filter((req) => req.status === "pending") ?? [];
}

export async function requestJoinGroup(chatId: string, userId: string) {
  const chat = getState().chats.find((item) => item.id === chatId);
  if (!chat) throw new Error("Group not found");
  if (chat.memberIds.includes(userId)) {
    throw new Error("You are already a member of this group.");
  }

  const pending = ensureJoinRequestList(chat.joinRequests).find((req) => req.userId === userId);
  if (pending) {
    throw new Error("Your join request is already pending approval.");
  }

  try {
    const supabase = ensureSupabase();
    const { error } = await supabase.from("join_requests").insert([
      { chat_id: chatId, user_id: userId, status: "pending", requested_at: new Date().toISOString() },
    ]);
    if (error) throw error;
  } catch (err) {
    console.warn("requestJoinGroup: failed to persist join request, applying locally:", err);
  }

  setState((s) => {
    const target = s.chats.find((item) => item.id === chatId);
    if (!target) return;
    target.joinRequests = [
      ...(target.joinRequests ?? []),
      { userId, requestedAt: Date.now(), status: "pending" },
    ];
  });
  saveList("chats", getState().chats);

  publish("chats:changed");
  publish(`chat:${chatId}`);
}

export async function approveJoinGroupRequest(chatId: string, userId: string) {
  try {
    const supabase = ensureSupabase();
    const { error } = await supabase
      .from("join_requests")
      .update({ status: "approved" })
      .eq("chat_id", chatId)
      .eq("user_id", userId);
    if (error) throw error;

    const { error: memError } = await supabase
      .from("chat_members")
      .insert([{ chat_id: chatId, user_id: userId }]);
    // 23505 = already a member; treat as success
    if (memError && (memError as any).code !== "23505") throw memError;
  } catch (err) {
    console.warn("approveJoinGroupRequest: supabase failed, applying locally:", err);
  }

  setState((s) => {
    const target = s.chats.find((item) => item.id === chatId);
    if (!target) return;
    target.joinRequests = (target.joinRequests ?? []).filter((req) => req.userId !== userId);
    if (!target.memberIds.includes(userId)) target.memberIds.push(userId);
  });
  saveList("chats", getState().chats);

  publish("chats:changed");
  publish(`chat:${chatId}`);
}

export async function rejectJoinGroupRequest(chatId: string, userId: string) {
  try {
    const supabase = ensureSupabase();
    const { error } = await supabase
      .from("join_requests")
      .update({ status: "rejected" })
      .eq("chat_id", chatId)
      .eq("user_id", userId);
    if (error) throw error;
  } catch (err) {
    console.warn("rejectJoinGroupRequest: supabase failed, applying locally:", err);
  }

  setState((s) => {
    const target = s.chats.find((item) => item.id === chatId);
    if (!target) return;
    target.joinRequests = (target.joinRequests ?? []).filter((req) => req.userId !== userId);
  });
  saveList("chats", getState().chats);

  publish("chats:changed");
  publish(`chat:${chatId}`);
}
