import { getState, setState, uid, ensureSeed, type Channel, type ChannelPost, type Comment, type JoinRequest } from "@/lib/mockStore";
import { publish, subscribe } from "@/lib/eventBus";
import { ensureSupabase, supabaseConfigured } from "@/lib/supabaseClient";
import { uploadImage, getImageUrl, batchGetImageUrls, deleteStorageFile } from "@/lib/imageUpload";
import { resolveMedia, primeMediaCache } from "@/lib/mediaCache";

function isFullUrl(value?: string): boolean {
  return !!value && /^(https?:\/\/|data:|blob:)/i.test(value);
}

function mapChannel(row: any, members: string[], adminIds: string[]): Channel {
  const visibility = row.visibility ?? (row.is_public === false ? "private" : "public");
  const defaultReactionEmojis = ["❤️", "👍", "🎉", "😮", "💲"];
  const allowedReactionEmojis = Array.isArray(row.allowed_reaction_emojis)
    ? row.allowed_reaction_emojis
    : Array.isArray(row.reaction_emojis)
      ? row.reaction_emojis
      : defaultReactionEmojis;

  return {
    id: row.id,
    name: row.name,
    description: row.description,
    avatar: row.avatar_url ?? `https://api.dicebear.com/7.x/shapes/svg?seed=${encodeURIComponent(row.name)}`,
    wallpaper: row.wallpaper_url ?? undefined,
    ownerId: row.owner_id,
    adminIds,
    memberIds: members,
    onlyAdminsPost: row.only_admins_post ?? true,
    createdAt: new Date(row.created_at).getTime(),
    visibility,
    discussionChatId: row.discussion_chat_id ?? null,
    autoTranslateEnabled: row.auto_translate_enabled ?? false,
    allowDirectMessages: row.allow_direct_messages ?? false,
    inviteLink: row.invite_link ?? null,
    communityId: row.community_id ?? null,
    appearanceColor: row.appearance_color ?? "#7c3aed",
    allowedReactionEmojis,
  };
}

async function fetchChannelAdmins(channelIds: string[]) {
  try {
    const supabase = ensureSupabase();
    const { data, error } = await supabase
      .from("channel_members")
      .select("channel_id,user_id,is_admin")
      .in("channel_id", channelIds)
      .eq("is_admin", true);

    if (error) {
      console.warn("Unable to fetch channel admin flags:", error);
      return [];
    }
    return data ?? [];
  } catch (error) {
    console.warn("Unable to fetch channel admins:", error);
    return [];
  }
}

async function resolveChannelAvatars(channels: Channel[]): Promise<Channel[]> {
  const avatarPaths = channels.map((ch) => ch.avatar && !isFullUrl(ch.avatar) ? ch.avatar : undefined);
  const wallpaperPaths = channels.map((ch) => ch.wallpaper && !isFullUrl(ch.wallpaper) ? ch.wallpaper : undefined);

  const signedAvatars = await batchGetImageUrls("channel-media", avatarPaths);
  const signedWallpapers = await batchGetImageUrls("channel-media", wallpaperPaths);

  // Serve previously-seen channel art from the device media cache
  return Promise.all(channels.map(async (ch, idx) => ({
    ...ch,
    avatar: avatarPaths[idx] && signedAvatars[idx]
      ? await resolveMedia(() => Promise.resolve(signedAvatars[idx] as string), avatarPaths[idx])
      : (signedAvatars[idx] ?? ch.avatar),
    wallpaper: wallpaperPaths[idx] && signedWallpapers[idx]
      ? await resolveMedia(() => Promise.resolve(signedWallpapers[idx] as string), wallpaperPaths[idx])
      : (signedWallpapers[idx] ?? ch.wallpaper),
  })));
}

async function fetchChannelMembers(channelIds: string[]) {
  try {
    const supabase = ensureSupabase();
    const { data, error } = await supabase
      .from("channel_members")
      .select("channel_id,user_id")
      .in("channel_id", channelIds);

    if (error) {
      console.warn("Unable to fetch channel members:", error);
      return [];
    }
    return data ?? [];
  } catch (error) {
    console.warn("Unable to fetch channel members:", error);
    return [];
  }
}

export async function listChannels(): Promise<Channel[]> {
  ensureSeed(); // Ensure seed data is available as fallback
  try {
    const supabase = ensureSupabase();
    const { data: channels, error: channelError } = await supabase
      .from("channels")
      .select("*")
      .order("created_at", { ascending: false });

    if (!channelError && channels) {
      const channelIds = channels.map((c) => c.id);
      const memberRows = await fetchChannelMembers(channelIds);
      const adminRows = await fetchChannelAdmins(channelIds);
      
      let remoteChannels = channels.map((ch) => {
        const members = memberRows
          .filter((row) => row.channel_id === ch.id)
          .map((row) => row.user_id);
        const adminIds = adminRows
          .filter((row) => row.channel_id === ch.id)
          .map((row) => row.user_id);
        const allMembers = [ch.owner_id, ...members].filter((v, i, a) => a.indexOf(v) === i);
        const cached = getState().channels.find((c) => c.id === ch.id);
        const remoteChannel = mapChannel(ch, allMembers, adminIds);
        if (cached?.visibility) remoteChannel.visibility = cached.visibility;
        return remoteChannel;
      });

      remoteChannels = await resolveChannelAvatars(remoteChannels);
      setState((s) => { s.channels = remoteChannels; });
      return remoteChannels;
    }

    if (channelError) {
      console.error("listChannels: failed to query Supabase channels", channelError);
    }
  } catch (error) {
    console.warn("Unable to load remote channels, returning cached channels:", error);
  }
  const fallbackChannels = getState().channels;
  console.warn(`[Supabase offline] Returning ${fallbackChannels.length} cached/seeded channels`);
  return fallbackChannels;
}

export async function getChannel(id: string): Promise<Channel | undefined> {
  ensureSeed(); // Ensure seed data is available as fallback
  try {
    const supabase = ensureSupabase();
    const { data: channelRow, error: channelError } = await supabase
      .from("channels")
      .select("*")
      .eq("id", id)
      .single();

    if (!channelError && channelRow) {
      const { data: memberRows } = await supabase
        .from("channel_members")
        .select("user_id")
        .eq("channel_id", id);
      const { data: adminRows } = await supabase
        .from("channel_members")
        .select("user_id")
        .eq("channel_id", id)
        .eq("is_admin", true);
      
      const members = (memberRows ?? []).map((row) => row.user_id);
      const adminIds = (adminRows ?? []).map((row) => row.user_id);
      const allMembers = [channelRow.owner_id, ...members].filter((v, i, a) => a.indexOf(v) === i);
      const cached = getState().channels.find((c) => c.id === id);
      const remoteChannel = mapChannel(channelRow, allMembers, adminIds);
      if (cached?.visibility) remoteChannel.visibility = cached.visibility;
      if (!isFullUrl(remoteChannel.avatar)) {
        remoteChannel.avatar = await resolveMedia(
          () => getImageUrl("channel-media", remoteChannel.avatar as string),
          remoteChannel.avatar,
        );
      }
      if (remoteChannel.wallpaper && !isFullUrl(remoteChannel.wallpaper)) {
        remoteChannel.wallpaper = await resolveMedia(
          () => getImageUrl("channel-media", remoteChannel.wallpaper as string),
          remoteChannel.wallpaper,
        );
      }
      setState((s) => {
        const idx = s.channels.findIndex((c) => c.id === id);
        if (idx >= 0) s.channels[idx] = remoteChannel;
        else s.channels.push(remoteChannel);
      });
      return remoteChannel;
    }

    if (channelError) {
      console.error("getChannel: failed to query Supabase channel", id, channelError);
    }
  } catch (error) {
    console.error("getChannel: exception, falling back to cached channel:", error);
  }
  
  const cached = getState().channels.find((c) => c.id === id);
  console.warn(`[Supabase offline] Returning cached/seeded channel for ID ${id}`);
  return cached;
}

export async function createChannel(input: { name: string; description: string; ownerId: string; onlyAdminsPost?: boolean; visibility?: "public" | "private" }) {
  const supabase = ensureSupabase();
  const visibility = input.visibility ?? "public";
  
  const avatar = `https://api.dicebear.com/7.x/shapes/svg?seed=${encodeURIComponent(input.name)}`;
  
  const { data: channelRow, error: createError } = await supabase
    .from("channels")
    .insert([{
      name: input.name,
      description: input.description,
      avatar_url: avatar,
      owner_id: input.ownerId,
      visibility,
    }])
    .select()
    .single();

  if (createError || !channelRow) {
    throw new Error(createError?.message || "Failed to create channel");
  }

  // Add owner as initial member
  const { error: memberError } = await supabase
    .from("channel_members")
    .insert([{ channel_id: channelRow.id, user_id: input.ownerId }]);

  if (memberError) {
    console.warn("Failed to add owner as member:", memberError);
  }

  const ch = mapChannel({ ...channelRow, visibility }, [input.ownerId], [input.ownerId]);
  if (!isFullUrl(ch.avatar)) {
    ch.avatar = await resolveMedia(() => getImageUrl("channel-media", ch.avatar as string), ch.avatar);
  }
  setState((s) => {
    const existing = s.channels.find((c) => c.id === ch.id);
    if (existing) {
      Object.assign(existing, ch);
    } else {
      s.channels.unshift(ch);
    }
  });
  publish("channels:changed");
  return ch;
}

export async function updateChannel(id: string, updates: { onlyAdminsPost?: boolean; adminIds?: string[]; name?: string; description?: string; avatar?: string; wallpaper?: string | null; visibility?: "public" | "private"; appearanceColor?: string; allowedReactionEmojis?: string[] }) {
  const supabase = ensureSupabase();
  
  const updateData: any = {};
  if (updates.onlyAdminsPost !== undefined) {
    updateData.only_admins_post = updates.onlyAdminsPost;
  }
  if (updates.name !== undefined) {
    updateData.name = updates.name;
  }
  if (updates.description !== undefined) {
    updateData.description = updates.description;
  }
  if (updates.avatar !== undefined) {
    updateData.avatar_url = updates.avatar;
  }
  if (updates.wallpaper !== undefined) {
    updateData.wallpaper_url = updates.wallpaper;
  }
  if (updates.visibility !== undefined) {
    updateData.visibility = updates.visibility;
  }
  if (updates.appearanceColor !== undefined) {
    updateData.appearance_color = updates.appearanceColor;
  }
  if (updates.allowedReactionEmojis !== undefined) {
    updateData.allowed_reaction_emojis = updates.allowedReactionEmojis;
  }

  if (Object.keys(updateData).length > 0) {
    try {
      const { error } = await supabase
        .from("channels")
        .update(updateData)
        .eq("id", id);

      if (error) {
        console.warn("updateChannel persisted partially via Supabase:", error.message);
      }
    } catch (error) {
      console.warn("updateChannel persisted locally only:", error instanceof Error ? error.message : error);
    }
  }

  if (updates.visibility !== undefined || updates.avatar !== undefined || updates.wallpaper !== undefined || updates.name !== undefined || updates.description !== undefined || updates.appearanceColor !== undefined || updates.allowedReactionEmojis !== undefined) {
    setState((s) => {
      const channel = s.channels.find((c) => c.id === id);
      if (!channel) return;
      if (updates.visibility !== undefined) channel.visibility = updates.visibility;
      if (updates.name !== undefined) channel.name = updates.name;
      if (updates.description !== undefined) channel.description = updates.description;
      if (updates.avatar !== undefined) {
        channel.avatar = isFullUrl(updates.avatar)
          ? updates.avatar
          : `channel-media:${updates.avatar}`;
      }
      if (updates.wallpaper !== undefined) {
        channel.wallpaper = updates.wallpaper === null ? undefined : (isFullUrl(updates.wallpaper) ? updates.wallpaper : `channel-media:${updates.wallpaper}`);
      }
      if (updates.appearanceColor !== undefined) channel.appearanceColor = updates.appearanceColor;
      if (updates.allowedReactionEmojis !== undefined) channel.allowedReactionEmojis = updates.allowedReactionEmojis;
    });
  }

  if (updates.avatar !== undefined && !isFullUrl(updates.avatar)) {
    const resolvedAvatar = await resolveMedia(() => getImageUrl("channel-media", updates.avatar as string), updates.avatar);
    setState((s) => {
      const channel = s.channels.find((c) => c.id === id);
      if (channel) channel.avatar = resolvedAvatar;
    });
  }

  if (updates.wallpaper !== undefined && updates.wallpaper !== null && !isFullUrl(updates.wallpaper)) {
    const resolvedWallpaper = await resolveMedia(() => getImageUrl("channel-media", updates.wallpaper as string), updates.wallpaper);
    setState((s) => {
      const channel = s.channels.find((c) => c.id === id);
      if (channel) channel.wallpaper = resolvedWallpaper;
    });
  }

  publish("channels:changed");
}

export type ChannelAdmin = {
  userId: string;
  email: string;
  displayName: string;
  avatar: string;
  isAdmin: boolean;
  joinedAt?: number;
};

export type ChannelSubscriber = {
  userId: string;
  email: string;
  displayName: string;
  avatar: string;
  isAdmin: boolean;
  joinedAt?: number;
};

export type ChannelRemovedMember = {
  userId: string;
  removedBy: string | null;
  reason: string | null;
  removedAt: number;
  email?: string;
  displayName?: string;
  avatar?: string;
};

export type ChannelStatistics = {
  views: number;
  likes: number;
  subscribers: number;
  growth: Array<{ date: string; members: number }>;
};

export async function addChannelAdmin(channelId: string, userId: string) {
  const supabase = ensureSupabase();
  try {
    const { data, error } = await supabase.from("channel_members").upsert(
      { channel_id: channelId, user_id: userId, is_admin: true },
      { onConflict: "channel_id,user_id" }
    );
    if (error) throw error;
  } catch (err) {
    console.warn("addChannelAdmin: supabase update failed, applying locally:", err);
  }

  setState((s) => {
    const ch = s.channels.find((c) => c.id === channelId);
    if (ch && !ch.adminIds.includes(userId)) {
      ch.adminIds.push(userId);
    }
  });
  publish("channels:changed");
}

export async function removeChannelAdmin(channelId: string, userId: string) {
  const supabase = ensureSupabase();
  try {
    const { data, error } = await supabase
      .from("channel_members")
      .update({ is_admin: false })
      .eq("channel_id", channelId)
      .eq("user_id", userId);
    if (error) throw error;
  } catch (err) {
    console.warn("removeChannelAdmin: supabase update failed, applying locally:", err);
  }

  setState((s) => {
    const ch = s.channels.find((c) => c.id === channelId);
    if (ch) {
      ch.adminIds = ch.adminIds.filter((id) => id !== userId);
    }
  });
  publish("channels:changed");
}

export async function updateChannelType(channelId: string, visibility: "public" | "private") {
  const supabase = ensureSupabase();
  const { error } = await supabase
    .from("channels")
    .update({ visibility })
    .eq("id", channelId);
  if (error) throw error;

  setState((s) => {
    const channel = s.channels.find((c) => c.id === channelId);
    if (channel) channel.visibility = visibility;
  });
  publish("channels:changed");
}

export async function updateChannelSettings(channelId: string, settings: { autoTranslateEnabled?: boolean; allowDirectMessages?: boolean }) {
  const supabase = ensureSupabase();
  const updateData: any = {};
  if (settings.autoTranslateEnabled !== undefined) updateData.auto_translate_enabled = settings.autoTranslateEnabled;
  if (settings.allowDirectMessages !== undefined) updateData.allow_direct_messages = settings.allowDirectMessages;

  if (Object.keys(updateData).length > 0) {
    const { error } = await supabase
      .from("channels")
      .update(updateData)
      .eq("id", channelId);
    if (error) throw error;
  }

  setState((s) => {
    const channel = s.channels.find((c) => c.id === channelId);
    if (!channel) return;
    if (settings.autoTranslateEnabled !== undefined) channel.autoTranslateEnabled = settings.autoTranslateEnabled;
    if (settings.allowDirectMessages !== undefined) channel.allowDirectMessages = settings.allowDirectMessages;
  });
  publish("channels:changed");
}

export async function setChannelDiscussion(channelId: string, discussionChatId: string | null) {
  const supabase = ensureSupabase();
  const { error } = await supabase
    .from("channels")
    .update({ discussion_chat_id: discussionChatId })
    .eq("id", channelId);
  if (error) throw error;

  setState((s) => {
    const channel = s.channels.find((c) => c.id === channelId);
    if (channel) channel.discussionChatId = discussionChatId;
  });
  publish("channels:changed");
}

export async function getChannelAdmins(channelId: string): Promise<ChannelAdmin[]> {
  try {
    const supabase = ensureSupabase();
    const { data, error } = await supabase
      .from("channel_members")
      .select("user_id,is_admin,joined_at,profiles(id,email,display_name,avatar_url)")
      .eq("channel_id", channelId)
      .order("joined_at", { ascending: false });
    if (!error && data) {
      return (data as any).map((row: any) => ({
        userId: row.user_id,
        email: row.profiles?.email ?? "",
        displayName: row.profiles?.display_name ?? row.user_id,
        avatar: row.profiles?.avatar_url ? (isFullUrl(row.profiles.avatar_url) ? row.profiles.avatar_url : `https://api.dicebear.com/7.x/shapes/svg?seed=${encodeURIComponent(row.profiles.email ?? row.user_id)}`) : `https://api.dicebear.com/7.x/shapes/svg?seed=${encodeURIComponent(row.profiles?.email ?? row.user_id)}`,
        isAdmin: row.is_admin,
        joinedAt: row.joined_at ? new Date(row.joined_at).getTime() : undefined,
      }));
    }
  } catch (err) {
    console.warn("getChannelAdmins: failed fetching admins, fallback local:", err);
  }

  const channel = getState().channels.find((c) => c.id === channelId);
  const adminIds = channel?.adminIds ?? [];
  return getState().users
    .filter((user) => adminIds.includes(user.id))
    .map((user) => ({
      userId: user.id,
      email: user.email,
      displayName: user.displayName,
      avatar: user.avatar,
      isAdmin: true,
    }));
}

export async function promoteToChannelAdmin(channelId: string, userId: string) {
  return addChannelAdmin(channelId, userId);
}

export async function demoteChannelAdmin(channelId: string, userId: string) {
  return removeChannelAdmin(channelId, userId);
}

export async function getChannelSubscribers(channelId: string, options: { search?: string; cursor?: number } = {}) {
  const pageSize = 20;
  const start = options.cursor ?? 0;
  try {
    const supabase = ensureSupabase();
    let query = supabase
      .from("channel_members")
      .select("user_id,is_admin,joined_at,profiles(id,email,display_name,avatar_url)", { count: "exact" })
      .eq("channel_id", channelId)
      .order("joined_at", { ascending: false })
      .range(start, start + pageSize - 1);

    if (options.search) {
      const term = `%${options.search.replace(/%/g, "\\%").replace(/_/g, "\\_")}%`;
      query = query.or(`profiles.display_name.ilike.${term},profiles.email.ilike.${term}`);
    }

    const { data, error, count } = await query;
    if (!error && data) {
      const rows = data as any[];
      return {
        subscribers: rows.map((row) => ({
          userId: row.user_id,
          email: row.profiles?.email ?? "",
          displayName: row.profiles?.display_name ?? row.user_id,
          avatar: row.profiles?.avatar_url ? (isFullUrl(row.profiles.avatar_url) ? row.profiles.avatar_url : `https://api.dicebear.com/7.x/shapes/svg?seed=${encodeURIComponent(row.profiles.email ?? row.user_id)}`) : `https://api.dicebear.com/7.x/shapes/svg?seed=${encodeURIComponent(row.profiles?.email ?? row.user_id)}`,
          isAdmin: row.is_admin,
          joinedAt: row.joined_at ? new Date(row.joined_at).getTime() : undefined,
        })),
        nextCursor: rows.length === pageSize ? start + pageSize : null,
        total: count ?? null,
      };
    }
  } catch (err) {
    console.warn("getChannelSubscribers: failed fetching from supabase, falling back local:", err);
  }

  const channel = getState().channels.find((c) => c.id === channelId);
  const members = channel?.memberIds ?? [];
  const matched = getState().users.filter((user) => members.includes(user.id) && (!options.search || user.displayName.toLowerCase().includes(options.search.toLowerCase()) || user.email.toLowerCase().includes(options.search.toLowerCase())));
  return {
    subscribers: matched.slice(start, start + pageSize).map((user) => ({
      userId: user.id,
      email: user.email,
      displayName: user.displayName,
      avatar: user.avatar,
      isAdmin: channel?.adminIds.includes(user.id) ?? false,
      joinedAt: undefined,
    })),
    nextCursor: matched.length > start + pageSize ? start + pageSize : null,
    total: matched.length,
  };
}

export async function getChannelStatistics(channelId: string): Promise<ChannelStatistics> {
  try {
    const supabase = ensureSupabase();
    const { data: posts, error: postsError } = await supabase
      .from("channel_posts")
      .select("id,view_count")
      .eq("channel_id", channelId);

    const postIds = (posts ?? []).map((p: any) => p.id);
    const views = (posts ?? []).reduce((sum: number, p: any) => sum + (Number(p.view_count) || 0), 0);

    let likes = 0;
    if (postIds.length > 0) {
      const { count, error: likeError } = await supabase
        .from("channel_post_reactions")
        .select("id", { count: "exact", head: true })
        .in("post_id", postIds);
      if (likeError) throw likeError;
      likes = count ?? 0;
    }

    const { data: members, error: memberError } = await supabase
      .from("channel_members")
      .select("joined_at")
      .eq("channel_id", channelId)
      .order("joined_at", { ascending: true });
    if (memberError) throw memberError;

    const growthMap = new Map<string, number>();
    (members ?? []).forEach((row: any) => {
      const date = new Date(row.joined_at).toISOString().slice(0, 10);
      growthMap.set(date, (growthMap.get(date) ?? 0) + 1);
    });

    const growth = Array.from(growthMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, membersCount]) => ({ date, members: membersCount }));

    return {
      views,
      likes,
      subscribers: (members ?? []).length,
      growth,
    };
  } catch (err) {
    console.warn("getChannelStatistics: failed, falling back to local estimates:", err);
    const channel = getState().channels.find((c) => c.id === channelId);
    return {
      views: 0,
      likes: 0,
      subscribers: channel?.memberIds.length ?? 0,
      growth: [],
    };
  }
}

export async function removeChannelMember(channelId: string, userId: string, reason: string | null, removedBy: string | null = null) {
  const supabase = ensureSupabase();
  const removedAt = new Date().toISOString();
  try {
    const { error } = await supabase.from("removed_channel_members").insert([
      { channel_id: channelId, user_id: userId, removed_by: removedBy, reason, removed_at: removedAt },
    ]);
    if (error) throw error;

    const { error: deleteError } = await supabase
      .from("channel_members")
      .delete()
      .eq("channel_id", channelId)
      .eq("user_id", userId);
    if (deleteError) throw deleteError;
  } catch (err) {
    console.warn("removeChannelMember: failed, applying locally where possible:", err);
  }

  setState((s) => {
    const channel = s.channels.find((c) => c.id === channelId);
    if (!channel) return;
    channel.memberIds = channel.memberIds.filter((id) => id !== userId);
  });
  publish("channels:changed");
}

export async function getRemovedMembers(channelId: string): Promise<ChannelRemovedMember[]> {
  try {
    const supabase = ensureSupabase();
    const { data, error } = await supabase
      .from("removed_channel_members")
      .select("user_id,removed_by,reason,removed_at,profiles(id,email,display_name,avatar_url)")
      .eq("channel_id", channelId)
      .order("removed_at", { ascending: false });

    if (!error && data) {
      return (data as any).map((row: any) => ({
        userId: row.user_id,
        removedBy: row.removed_by ?? null,
        reason: row.reason ?? null,
        removedAt: new Date(row.removed_at).getTime(),
        email: row.profiles?.email,
        displayName: row.profiles?.display_name,
        avatar: row.profiles?.avatar_url ? (isFullUrl(row.profiles.avatar_url) ? row.profiles.avatar_url : `https://api.dicebear.com/7.x/shapes/svg?seed=${encodeURIComponent(row.profiles.email ?? row.user_id)}`) : `https://api.dicebear.com/7.x/shapes/svg?seed=${encodeURIComponent(row.profiles?.email ?? row.user_id)}`,
      }));
    }
  } catch (err) {
    console.warn("getRemovedMembers: failed to fetch removed members, fallback local:", err);
  }

  return [];
}

export async function unbanChannelMember(channelId: string, userId: string) {
  const supabase = ensureSupabase();
  const { error } = await supabase
    .from("removed_channel_members")
    .delete()
    .eq("channel_id", channelId)
    .eq("user_id", userId);
  if (error) throw error;
}

export type ChannelRecentAction = {
  id: string;
  adminId: string;
  action: string;
  targetType: string;
  targetId: string;
  meta?: any;
  createdAt: number;
};

export async function getChannelRecentActions(channelId: string): Promise<ChannelRecentAction[]> {
  try {
    const supabase = ensureSupabase();
    const { data, error } = await supabase
      .from("audit_logs")
      .select("id,admin_id,action,target_type,target_id,meta,created_at")
      .eq("target_type", "channel")
      .eq("target_id", channelId)
      .order("created_at", { ascending: false })
      .limit(50);

    if (!error && data) {
      return (data as any).map((row: any) => ({
        id: row.id,
        adminId: row.admin_id,
        action: row.action,
        targetType: row.target_type,
        targetId: row.target_id,
        meta: row.meta,
        createdAt: new Date(row.created_at).getTime(),
      }));
    }
  } catch (err) {
    console.warn("getChannelRecentActions: failed, fallback local:", err);
  }
  return [];
}

export async function deleteChannel(channelId: string) {
  const supabase = ensureSupabase();
  try {
    const { data: postRows, error: postFetchError } = await supabase
      .from("channel_posts")
      .select("id")
      .eq("channel_id", channelId);
    if (postFetchError) throw postFetchError;

    const postIds = (postRows ?? []).map((row: any) => row.id);
    if (postIds.length > 0) {
      const { error: reactionError } = await supabase
        .from("channel_post_reactions")
        .delete()
        .in("post_id", postIds);
      if (reactionError) throw reactionError;
    }

    const { error: postsError } = await supabase
      .from("channel_posts")
      .delete()
      .eq("channel_id", channelId);
    if (postsError) throw postsError;

    const { error: membersError } = await supabase
      .from("channel_members")
      .delete()
      .eq("channel_id", channelId);
    if (membersError) throw membersError;

    const { error: removedError } = await supabase
      .from("removed_channel_members")
      .delete()
      .eq("channel_id", channelId);
    if (removedError) throw removedError;

    const { error: joinError } = await supabase
      .from("join_requests")
      .delete()
      .eq("channel_id", channelId);
    if (joinError) throw joinError;

    // NOTE: channel_communities is a parent entity table in the live schema
    // (channels.community_id FK) — no per-channel rows to delete here.

    const { error: channelError } = await supabase
      .from("channels")
      .delete()
      .eq("id", channelId);
    if (channelError) throw channelError;

    setState((s) => {
      s.channels = s.channels.filter((c) => c.id !== channelId);
    });
    publish("channels:changed");
  } catch (err) {
    console.error("Failed to delete channel:", err);
    throw err;
  }
}

export async function requestJoinChannel(channelId: string, userId: string) {
  const supabase = ensureSupabase();
  try {
    const { data, error } = await supabase
      .from("join_requests")
      .insert([{ channel_id: channelId, user_id: userId, status: "pending", requested_at: new Date().toISOString() }]);
    if (error) throw error;
  } catch (err) {
    console.warn("requestJoinChannel: failed to persist join request, applying locally:", err);
  }

  setState((s) => {
    const ch = s.channels.find((c) => c.id === channelId);
    if (!ch) return;
    ch.joinRequests = ch.joinRequests ?? [];
    ch.joinRequests.push({ userId, requestedAt: Date.now(), status: "pending" });
  });
  publish("channels:changed");
}

export async function approveJoinChannelRequest(channelId: string, userId: string) {
  const supabase = ensureSupabase();
  try {
    const { error } = await supabase
      .from("join_requests")
      .update({ status: "approved" })
      .eq("channel_id", channelId)
      .eq("user_id", userId);
    if (error) throw error;

    const { error: memError } = await supabase.from("channel_members").insert([{ channel_id: channelId, user_id: userId }]);
    // 23505 = already a member; treat as success
    if (memError && (memError as any).code !== "23505") throw memError;
  } catch (err) {
    console.warn("approveJoinChannelRequest: supabase failed, applying locally:", err);
  }

  setState((s) => {
    const ch = s.channels.find((c) => c.id === channelId);
    if (!ch) return;
    ch.memberIds = Array.from(new Set([...(ch.memberIds ?? []), userId]));
    ch.joinRequests = (ch.joinRequests ?? []).filter((r) => r.userId !== userId);
  });
  publish("channels:changed");
}

export async function rejectJoinChannelRequest(channelId: string, userId: string) {
  const supabase = ensureSupabase();
  try {
    const { error } = await supabase
      .from("join_requests")
      .update({ status: "rejected" })
      .eq("channel_id", channelId)
      .eq("user_id", userId);
    if (error) throw error;
  } catch (err) {
    console.warn("rejectJoinChannelRequest: supabase failed, applying locally:", err);
  }

  setState((s) => {
    const ch = s.channels.find((c) => c.id === channelId);
    if (!ch) return;
    ch.joinRequests = (ch.joinRequests ?? []).filter((r) => r.userId !== userId);
  });
  publish("channels:changed");
}

export async function addChannelToCommunity(channelId: string, communityId: string) {
  const supabase = ensureSupabase();
  // Live schema stores the link directly on channels.community_id
  // (FK → channel_communities.id); there is no join table.
  const { error } = await supabase
    .from("channels")
    .update({ community_id: communityId })
    .eq("id", channelId);
  if (error) throw error;

  setState((s) => {
    const channel = s.channels.find((c) => c.id === channelId);
    if (channel) channel.communityId = communityId;
  });
  publish("channels:changed");
}

export async function listPosts(channelId?: string): Promise<ChannelPost[]> {
  ensureSeed(); // Ensure seed data is available as fallback

  try {
    const supabase = ensureSupabase();
    let query = supabase.from("channel_posts").select("*");
    if (channelId) query = query.eq("channel_id", channelId);

    const { data: posts, error } = await query.order("created_at", { ascending: false });

    if (!error && posts) {
      // Map Supabase posts to ChannelPost type
      const mappedPosts: ChannelPost[] = posts.map((p: any) => ({
        id: p.id,
        channelId: p.channel_id,
        authorId: p.author_id,
        kind: p.kind,
        body: p.body,
        image: p.image_url,
        likes: [], // Will fetch reactions separately
        views: [], // Will track via view_count
        createdAt: new Date(p.created_at).getTime(),
        boostedLikes: p.boosted_likes,
        boostedViews: p.boosted_views,
        pinned: p.pinned,
      }));
      console.log("🗺️  [listPosts] Mapped posts:", mappedPosts.length);

      // Batch-resolve image_url storage paths to signed URLs, serving
      // previously-seen post images straight from the device cache.
      const imagePaths = mappedPosts.map((p) => p.image ?? null);
      const imageUrls = await batchGetImageUrls("channel-media", imagePaths);
      const resolved = await Promise.all(mappedPosts.map(async (p, i) => ({
        ...p,
        image: imagePaths[i] && imageUrls[i]
          ? await resolveMedia(() => Promise.resolve(imageUrls[i] as string), imagePaths[i])
          : (imageUrls[i] ?? p.image),
      })));
      return resolved;
    }

    if (error) {
      console.error("listPosts: Supabase error - falling back to mock store:", { channelId, error });
    }
  } catch (error) {
    console.error("listPosts: exception - falling back to mock store:", error);
  }
  
  const allChannelPosts = getState().channelPosts;
  const posts = channelId
    ? allChannelPosts.filter((p) => p.channelId === channelId)
    : [...allChannelPosts];
  
  const sorted = posts.sort((a, b) => b.createdAt - a.createdAt);
  console.warn(`[Supabase offline] Returning ${sorted.length} cached/seeded posts for channel ${channelId || "all"}`);
  return sorted;
}

export async function getPost(id: string): Promise<ChannelPost | undefined> {
  ensureSeed(); // Ensure seed data is available as fallback
  try {
    const supabase = ensureSupabase();
    const { data: post, error } = await supabase
      .from("channel_posts")
      .select("*")
      .eq("id", id)
      .single();

    if (!error && post) {
      const { data: reactions } = await supabase
        .from("channel_post_reactions")
        .select("user_id")
        .eq("post_id", id)
        .eq("emoji", "❤️");

      const rawImageUrl: string | undefined = post.image_url;
      const image = rawImageUrl
        ? await resolveMedia(() => getImageUrl("channel-media", rawImageUrl), rawImageUrl)
        : undefined;

      return {
        id: post.id,
        channelId: post.channel_id,
        authorId: post.author_id,
        kind: post.kind,
        body: post.body,
        image,
        likes: reactions?.map((r: any) => r.user_id) ?? [],
        views: [], // Approximate
        createdAt: new Date(post.created_at).getTime(),
        boostedLikes: post.boosted_likes,
        boostedViews: post.boosted_views,
        pinned: post.pinned,
      };
    }

    if (error) {
      console.error("getPost: failed to query Supabase post", id, error);
    }
  } catch (error) {
    console.warn("Unable to load remote post:", error);
  }
  return getState().channelPosts.find((p) => p.id === id);
}

export async function toggleChannelSubscribe(channelId: string, userId: string) {
  try {
    const supabase = ensureSupabase();
    
    // Check if user is already a member
    const { data: existing, error: checkError } = await supabase
      .from("channel_members")
      .select("*")
      .eq("channel_id", channelId)
      .eq("user_id", userId)
      .single();

    if (checkError && checkError.code !== "PGRST116") {
      throw checkError;
    }

    if (existing) {
      // Remove membership
      const { error: deleteError } = await supabase
        .from("channel_members")
        .delete()
        .eq("channel_id", channelId)
        .eq("user_id", userId);

      if (deleteError) throw deleteError;
    } else {
      // Add membership
      const { error: insertError } = await supabase
        .from("channel_members")
        .insert([{ channel_id: channelId, user_id: userId }]);

      if (insertError) throw insertError;
    }

    publish("channels:changed");
  } catch (error) {
    console.error("Failed to toggle channel subscription:", error);
    throw error;
  }
}

export async function createPost(input: {
  channelId: string;
  authorId: string;
  kind: "text" | "image";
  body: string;
  /** Pass a File to compress+upload via the image pipeline, or a pre-resolved URL/path. */
  image?: string | File;
}) {
  try {
    const supabase = ensureSupabase();
    
    // Verify channel exists
    const { data: channel } = await supabase
      .from("channels")
      .select("*")
      .eq("id", input.channelId)
      .single();

    if (!channel) throw new Error("Channel not found");

    // If image is a File, compress and upload it first
    let imageUrl: string | undefined;
    if (input.image instanceof File) {
      const path = await uploadImage(
        input.image,
        "channel-media",
        `${input.channelId}/posts`,
      );
      imageUrl = path; // store storage path in DB
    } else if (typeof input.image === "string" && input.image) {
      imageUrl = input.image;
    }

    const { data: post, error } = await supabase
      .from("channel_posts")
      .insert([{
        channel_id: input.channelId,
        author_id: input.authorId,
        kind: input.kind,
        body: input.body,
        image_url: imageUrl,
      }])
      .select()
      .single();

    if (error || !post) throw new Error(error?.message || "Failed to create post");

    // Resolve the stored path to a signed URL for immediate display,
    // caching it on-device so the author (and viewers) replay it locally.
    const displayImage = imageUrl
      ? await resolveMedia(() => getImageUrl("channel-media", imageUrl), imageUrl)
      : undefined;

    const mappedPost: ChannelPost = {
      id: post.id,
      channelId: post.channel_id,
      authorId: post.author_id,
      kind: post.kind,
      body: post.body,
      image: displayImage,
      likes: [],
      views: [],
      createdAt: new Date(post.created_at).getTime(),
      boostedLikes: post.boosted_likes,
      boostedViews: post.boosted_views,
    };

    // Ensure the local mock store reflects the newly created post so the UI
    // shows it immediately when Supabase is unreachable or while the
    // optimistic update completes.
    try {
      setState((s) => { s.channelPosts.unshift(mappedPost); });
    } catch (err) {
      // ignore
    }

    publish("channels:changed");
    publish(`channel:${input.channelId}`);
    return mappedPost;
  } catch (error) {
    console.error("Failed to create post:", error);
    throw error;
  }
}

export async function togglePostLike(postId: string, userId: string) {
  try {
    const supabase = ensureSupabase();

    const { error } = await supabase
      .rpc("toggle_channel_post_like", { p_post_id: postId, p_user_id: userId });

    if (error) throw error;

    publish("channels:changed");
  } catch (error) {
    console.error("Failed to toggle like:", error);
  }
}

export async function markPostViewed(postId: string, sessionId: string) {
  try {
    const supabase = ensureSupabase();
    // Atomically increment view_count to avoid race conditions
    try {
      const { error } = await supabase
        .rpc("atomic_increment_post_views", { p_post_id: postId, p_amount: 1 });
      if (error) console.warn("Failed to atomically increment view_count:", error);
    } catch {
      // Silently ignore — view count increment is non-critical
    }
  } catch (error) {
    console.warn("Failed to mark post viewed:", error);
  }
}

export async function deletePost(postId: string) {
  try {
    const supabase = ensureSupabase();

    // Retrieve image_url before deleting so we can clean up storage
    const { data: postRow } = await supabase
      .from("channel_posts")
      .select("image_url")
      .eq("id", postId)
      .single();

    const { error } = await supabase
      .from("channel_posts")
      .delete()
      .eq("id", postId);

    if (error) throw error;

    // Clean up storage file if one was attached
    if (postRow?.image_url) {
      await deleteStorageFile("channel-media", postRow.image_url);
    }

    publish("channels:changed");
  } catch (error) {
    console.error("Failed to delete post:", error);
    throw error;
  }
}

export async function editPost(postId: string, body: string) {
  try {
    const supabase = ensureSupabase();
    const { error } = await supabase
      .from("channel_posts")
      .update({ body, updated_at: new Date().toISOString() })
      .eq("id", postId);

    if (error) throw error;
    publish("channels:changed");
  } catch (error) {
    console.error("Failed to edit post:", error);
    throw error;
  }
}

export function likeCount(p: ChannelPost) {
  return (p.likes?.length ?? 0) + (p.boostedLikes ?? 0);
}

export function viewCount(p: ChannelPost) {
  return (p.views?.length ?? 0) + (p.boostedViews ?? 0);
}

export async function uploadChannelAvatar(channelId: string, file: File): Promise<string> {
  const path = await uploadImage(file, "channel-media", `${channelId}/avatar`, { maxDim: 256 });
  const signedUrl = await getImageUrl("channel-media", path);
  // The uploader already has the bytes — store them so future views are free
  await primeMediaCache(signedUrl, path);
  await updateChannel(channelId, { avatar: path });
  return signedUrl;
}

export function subscribeToChannels(cb: () => void) {
  const channelKey = "channels";

  const globalKey = Symbol.for("boochat.channelRealtime.listeners");
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
      const channel = supabase.channel(channelKey);
      const notify = () => {
        Array.from(globalState.handlers as Set<() => void>).forEach((handler) => handler());
      };

      channel.on("postgres_changes", { event: "*", schema: "public", table: "channels" }, notify);
      channel.on("postgres_changes", { event: "*", schema: "public", table: "channel_members" }, notify);
      channel.on("postgres_changes", { event: "*", schema: "public", table: "channel_posts" }, notify);
      channel.subscribe();
      globalState.subscription = channel;
    } catch (error) {
      console.warn("Unable to subscribe to channel updates:", error);
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
        console.warn("Failed to unsubscribe from channel realtime:", error);
      }
      globalState.subscription = null;
    }
  };
}

export async function listComments(postId: string): Promise<Comment[]> {
  try {
    const supabase = ensureSupabase();
    const { data: rows, error } = await supabase
      .from("comments")
      .select("*")
      .eq("message_id", postId)
      .eq("status", "approved")
      .order("created_at", { ascending: true });

    if (!error && rows) {
      const comments = rows.map(mapCommentRow);
      setState((s) => {
        const next = s.comments.filter((c) => c.postId !== postId);
        next.push(...comments);
        s.comments = next;
      });
      return comments;
    }
    if (error) {
      console.warn("listComments: Supabase comment query failed, trying local fallback:", error);
    }
  } catch (error) {
    console.warn("listComments: failed to load shared comments:", error);
  }

  return getState().comments.filter((c) => c.postId === postId).sort((a, b) => a.createdAt - b.createdAt);
}

export async function addComment(input: { postId: string; authorId: string; body: string }) {
  try {
    const supabase = ensureSupabase();
    const { data: row, error } = await supabase
      .from("comments")
      .insert([
        {
          message_id: input.postId,
          user_id: input.authorId,
          content: input.body,
          status: "approved",
        },
      ])
      .select()
      .single();

    if (error || !row) throw new Error(error?.message || "Failed to add comment");

    const comment = mapCommentRow(row);
    setState((s) => {
      const exists = s.comments.some((c) => c.id === comment.id);
      if (!exists) s.comments.push(comment);
    });
    publish(`comments:${input.postId}`);
    return comment;
  } catch (error) {
    console.error("addComment: failed to persist shared comment. Falling back to local mock state:", error);
    const fallback: Comment = { id: uid(), ...input, createdAt: Date.now() };
    setState((s) => { s.comments.push(fallback); });
    publish(`comments:${input.postId}`);
    return fallback;
  }
}

export function subscribeToComments(postId: string, cb: () => void) {
  const eventKey = `comments:${postId}`;
  if (!supabaseConfigured) {
    return subscribe(eventKey, cb);
  }

  try {
    const supabase = ensureSupabase();
    const channel = supabase.channel(eventKey);
    channel.on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "comments",
        filter: `message_id=eq.${postId}`,
      },
      async () => {
        try {
          await cb();
        } catch (err) {
          console.warn("subscribeToComments callback failed:", err);
        }
      },
    );
    channel.subscribe();

    return () => {
      try { channel.unsubscribe(); } catch {}
    };
  } catch (error) {
    console.warn("Unable to subscribe to shared comments, using local event fallback:", error);
    return subscribe(eventKey, cb);
  }
}

function mapCommentRow(row: any): Comment {
  return {
    id: row.id,
    postId: row.message_id ?? row.post_id,
    authorId: row.user_id ?? row.author_id,
    body: row.content ?? row.body,
    createdAt: new Date(row.created_at).getTime(),
  };
}

export function subscribeToPostComments(postId: string, cb: () => void) {
  return subscribeToComments(postId, cb);
}

export async function listPostComments(postId: string): Promise<Comment[]> {
  return listComments(postId);
}

export async function addPostComment(input: { postId: string; authorId: string; body: string }) {
  return addComment(input);
}

export async function deleteComment(commentId: string) {
  try {
    const supabase = ensureSupabase();
    const { error } = await supabase.from("comments").delete().eq("id", commentId);
    if (error) throw error;
    setState((s) => {
      s.comments = s.comments.filter((c) => c.id !== commentId);
    });
  } catch (error) {
    console.error("Failed to delete comment:", error);
    throw error;
  }
}

export async function editComment(commentId: string, body: string) {
  try {
    const supabase = ensureSupabase();
    const { error } = await supabase.from("comments").update({ content: body }).eq("id", commentId);
    if (error) throw error;
  } catch (error) {
    console.error("Failed to edit comment:", error);
    throw error;
  }
}
