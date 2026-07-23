import { ensureSupabase } from "@/lib/supabaseClient";
import { publish } from "@/lib/eventBus";
import { getState, setState, type Chat } from "@/lib/mockStore";

function mapChat(chat: any, members: string[], group: any | null): Chat {
  const visibility = chat.visibility ?? (chat.is_public === false ? "private" : "public");
  const base: Chat = {
    id: chat.id,
    type: chat.type,
    memberIds: members,
    createdAt: new Date(chat.created_at).getTime(),
    avatar: chat.avatar_url ?? undefined,
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
            const members = memberRows
              .filter((row) => row.chat_id === chatRow.id)
              .map((row) => row.user_id);
            const group = groups.find((g) => g.chat_id === chatRow.id) ?? null;
            const cached = getState().chats.find((c) => c.id === chatRow.id);
            const remoteChat = mapChat(chatRow, members, group);
            if (cached?.visibility) remoteChat.visibility = cached.visibility;
            return remoteChat;
          });

          setState((s) => { s.chats = remoteChats; });
          return remoteChats;
        }
      }
    }
  } catch (error) {
    console.warn("Unable to load remote chats, returning cached chats:", error);
  }
  return getState().chats;
}

export async function getChat(id: string): Promise<Chat | undefined> {
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
      const cached = getState().chats.find((c) => c.id === id);
      if (cached?.visibility) remoteChat.visibility = cached.visibility;
      setState((s) => {
        const idx = s.chats.findIndex((c) => c.id === id);
        if (idx >= 0) s.chats[idx] = remoteChat;
        else s.chats.push(remoteChat);
      });
      return remoteChat;
    }
  } catch (error) {
    console.warn("Unable to load remote chat, returning cached chat:", error);
  }
  return getState().chats.find((c) => c.id === id);
}

export async function getOrCreateDM(userA: string, userB: string): Promise<Chat> {
  const supabase = ensureSupabase();
  
  // Try to find existing chat first
  try {
    const { data: userAChats, error: userAError } = await supabase
      .from("chat_members")
      .select("chat_id")
      .eq("user_id", userA);
    if (!userAError && userAChats?.length) {
      const chatIds = userAChats.map((row) => row.chat_id);
      const { data: sharedChats, error: sharedError } = await supabase
        .from("chat_members")
        .select("chat_id")
        .in("chat_id", chatIds)
        .eq("user_id", userB);
      if (!sharedError && sharedChats?.length) {
        const sharedIds = sharedChats.map((row) => row.chat_id);
        const { data: chats, error: chatError } = await supabase
          .from("chats")
          .select("*")
          .in("id", sharedIds)
          .eq("type", "dm")
          .limit(1);
        if (!chatError && chats?.length) {
          const chat = chats[0];
          const { data: memberRows } = await supabase
            .from("chat_members")
            .select("user_id")
            .eq("chat_id", chat.id);
          return mapChat(chat, (memberRows ?? []).map((row) => row.user_id), null);
        }
      }
    }
  } catch (checkError) {
    console.warn("Error checking existing chats:", checkError);
  }

  // Create new chat via RPC so the backend can handle creator membership
  const { data: newChat, error: createChatError } = await supabase.rpc("create_chat", {
    _type: "dm",
    _name: null,
    _avatar_url: null,
  });
  if (createChatError || !newChat) {
    throw handleSupabaseError(createChatError, "Failed to create new chat. Check RLS policies on the 'chats' table.");
  }

  publish("chats:changed");
  return mapChat(newChat, [userA, userB], null);
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

  publish("chats:changed");
  return mapChat(newChat, members, { ...groupRow, visibility });
}

export async function updateChat(id: string, patch: Partial<Chat>) {
  const supabase = ensureSupabase();
  if (patch.name !== undefined || patch.avatar !== undefined || patch.muted !== undefined) {
    const update: Record<string, any> = {};
    if (patch.name !== undefined) update.name = patch.name;
    if (patch.avatar !== undefined) update.avatar_url = patch.avatar;
    if (patch.muted !== undefined) update.muted = patch.muted;
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
    }
  }

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

  publish("chats:changed");
}

export function subscribeToChats(cb: () => void) {
  try {
    const supabase = ensureSupabase();
    const channel = supabase.channel("chats");
    channel.on("postgres_changes", { event: "*", schema: "public", table: "chats" }, () => cb());
    channel.on("postgres_changes", { event: "*", schema: "public", table: "chat_members" }, () => cb());
    channel.subscribe();

    return () => {
      channel.unsubscribe();
    };
  } catch (error) {
    console.warn("Unable to subscribe to chat updates:", error);
    return () => undefined;
  }
}
