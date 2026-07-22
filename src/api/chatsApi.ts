import { ensureSupabase } from "@/lib/supabaseClient";
import { publish } from "@/lib/eventBus";
import type { Chat } from "@/lib/mockStore";

function mapChat(chat: any, members: string[], group: any | null): Chat {
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
    if (membershipError) {
      console.warn("Unable to load chats:", membershipError);
      return [];
    }

    const chatIds = (membershipRows ?? []).map((row) => row.chat_id);
    if (!chatIds.length) return [];

    const { data: chats, error: chatError } = await supabase
      .from("chats")
      .select("*")
      .in("id", chatIds)
      .order("updated_at", { ascending: false });
    if (chatError) {
      console.warn("Unable to load chats:", chatError);
      return [];
    }

    const memberRows = await fetchChatMembers(chatIds);
    const groupsData = await supabase.from("groups").select("*").in("chat_id", chatIds);
    if (groupsData.error) {
      console.warn("Unable to load chat groups:", groupsData.error);
    }
    const groups = groupsData.data ?? [];

    return (chats ?? []).map((chatRow) => {
      const members = memberRows
        .filter((row) => row.chat_id === chatRow.id)
        .map((row) => row.user_id);
      const group = groups.find((g) => g.chat_id === chatRow.id) ?? null;
      return mapChat(chatRow, members, group);
    });
  } catch (error) {
    console.warn("Unable to load chats:", error);
    return [];
  }
}

export async function getChat(id: string): Promise<Chat | undefined> {
  try {
    const supabase = ensureSupabase();
    const { data: chatRow, error: chatError } = await supabase
      .from("chats")
      .select("*")
      .eq("id", id)
      .single();
    if (chatError || !chatRow) return undefined;

    const { data: memberRows, error: memberError } = await supabase
      .from("chat_members")
      .select("user_id")
      .eq("chat_id", id);
    if (memberError) {
      console.warn("Unable to load chat members:", memberError);
      return mapChat(chatRow, [], null);
    }

    const members = (memberRows ?? []).map((row) => row.user_id);

    let group = null;
    if (chatRow.type === "group") {
      const { data: groupRow, error: groupError } = await supabase
        .from("groups")
        .select("*")
        .eq("chat_id", id)
        .single();
      if (groupError && groupError.code !== "PGRST116") {
        console.warn("Unable to load chat group metadata:", groupError);
      }
      group = groupRow ?? null;
    }

    return mapChat(chatRow, members, group);
  } catch (error) {
    console.warn("Unable to load chat:", error);
    return undefined;
  }
}

export async function getOrCreateDM(userA: string, userB: string): Promise<Chat> {
  const supabase = ensureSupabase();
  const { data: userAChats, error: userAError } = await supabase
    .from("chat_members")
    .select("chat_id")
    .eq("user_id", userA);
  if (userAError) throw handleSupabaseError(userAError, "Failed to fetch user's chats");

  const chatIds = (userAChats ?? []).map((row) => row.chat_id);
  if (chatIds.length) {
    const { data: sharedChats, error: sharedError } = await supabase
      .from("chat_members")
      .select("chat_id")
      .in("chat_id", chatIds)
      .eq("user_id", userB);
    if (sharedError) throw handleSupabaseError(sharedError, "Failed to check for existing chat");

    const sharedIds = (sharedChats ?? []).map((row) => row.chat_id);
    if (sharedIds.length) {
      const { data: chats, error: chatError } = await supabase
        .from("chats")
        .select("*")
        .in("id", sharedIds)
        .eq("type", "dm")
        .limit(1);
      if (chatError) throw handleSupabaseError(chatError, "Failed to fetch chat details");
      if (chats?.length) {
        const chat = chats[0];
        const { data: memberRows, error: memberError } = await supabase
          .from("chat_members")
          .select("user_id")
          .eq("chat_id", chat.id);
        if (memberError) throw handleSupabaseError(memberError, "Failed to fetch chat members");
        return mapChat(chat, (memberRows ?? []).map((row) => row.user_id), null);
      }
    }
  }

  const { data: newChat, error: createChatError } = await supabase
    .from("chats")
    .insert([{ type: "dm" }])
    .select()
    .single();
  if (createChatError || !newChat) {
    throw handleSupabaseError(createChatError, "Failed to create new chat. Check RLS policies on the 'chats' table.");
  }

  const { error: membershipError } = await supabase.from("chat_members").insert([
    { chat_id: newChat.id, user_id: userA },
    { chat_id: newChat.id, user_id: userB },
  ]);
  if (membershipError) {
    throw handleSupabaseError(membershipError, "Failed to add members to chat. Check RLS policies on the 'chat_members' table.");
  }

  publish("chats:changed");
  return mapChat(newChat, [userA, userB], null);
}

export async function createGroup(input: {
  name: string;
  memberIds: string[];
  ownerId: string;
  avatar?: string;
}): Promise<Chat> {
  const supabase = ensureSupabase();
  const { data: newChat, error: createChatError } = await supabase
    .from("chats")
    .insert([
      {
        type: "group",
        name: input.name,
        avatar_url: input.avatar,
      },
    ])
    .select()
    .single();
  if (createChatError || !newChat) {
    throw handleSupabaseError(createChatError, "Failed to create group. Check RLS policies on the 'chats' table.");
  }

  const { data: groupRow, error: createGroupError } = await supabase
    .from("groups")
    .insert([
      {
        chat_id: newChat.id,
        name: input.name,
        avatar_url: input.avatar,
        owner_id: input.ownerId,
      },
    ])
    .select()
    .single();
  if (createGroupError || !groupRow) {
    throw handleSupabaseError(createGroupError, "Failed to create group metadata. Check RLS policies on the 'groups' table.");
  }

  const members = Array.from(new Set([input.ownerId, ...input.memberIds]));
  const memberRows = members.map((userId) => ({ chat_id: newChat.id, user_id: userId }));
  const { error: membershipError } = await supabase.from("chat_members").insert(memberRows);
  if (membershipError) {
    throw handleSupabaseError(membershipError, "Failed to add members to group. Check RLS policies on the 'chat_members' table.");
  }

  publish("chats:changed");
  return mapChat(newChat, members, groupRow);
}

export async function updateChat(id: string, patch: Partial<Chat>) {
  const supabase = ensureSupabase();
  if (patch.name !== undefined || patch.avatar !== undefined) {
    const update: Record<string, any> = {};
    if (patch.name !== undefined) update.name = patch.name;
    if (patch.avatar !== undefined) update.avatar_url = patch.avatar;
    const { error } = await supabase.from("chats").update(update).eq("id", id);
    if (error) throw new Error(error.message);
  }

  if (patch.ownerId !== undefined || patch.permissions !== undefined) {
    const groupUpdate: Record<string, any> = {};
    if (patch.ownerId !== undefined) groupUpdate.owner_id = patch.ownerId;
    if (patch.permissions !== undefined) {
      groupUpdate.only_admins_post = patch.permissions.onlyAdminsPost;
      groupUpdate.only_admins_add = patch.permissions.onlyAdminsAdd;
    }
    const { error } = await supabase.from("groups").update(groupUpdate).eq("chat_id", id);
    if (error) throw new Error(error.message);
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
