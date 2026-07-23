import { getState, setState, uid, type Channel, type ChannelPost, type Comment, type JoinRequest } from "@/lib/mockStore";
import { publish, subscribe } from "@/lib/eventBus";
import { ensureSupabase } from "@/lib/supabaseClient";

function mapChannel(row: any, members: string[]): Channel {
  const visibility = row.visibility ?? (row.is_public === false ? "private" : "public");
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    avatar: row.avatar_url ?? `https://api.dicebear.com/7.x/shapes/svg?seed=${encodeURIComponent(row.name)}`,
    ownerId: row.owner_id,
    adminIds: [], // TODO: add admin management table if needed
    memberIds: members,
    onlyAdminsPost: true, // Default behavior
    createdAt: new Date(row.created_at).getTime(),
    visibility,
  };
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
  try {
    const supabase = ensureSupabase();
    const { data: channels, error: channelError } = await supabase
      .from("channels")
      .select("*")
      .order("created_at", { ascending: false });

    if (!channelError && channels) {
      const channelIds = channels.map((c) => c.id);
      const memberRows = await fetchChannelMembers(channelIds);
      
      const remoteChannels = channels.map((ch) => {
        const members = memberRows
          .filter((row) => row.channel_id === ch.id)
          .map((row) => row.user_id);
        // Always include owner as member
        const allMembers = [ch.owner_id, ...members].filter((v, i, a) => a.indexOf(v) === i);
        const cached = getState().channels.find((c) => c.id === ch.id);
        const remoteChannel = mapChannel(ch, allMembers);
        if (cached?.visibility) remoteChannel.visibility = cached.visibility;
        return remoteChannel;
      });

      setState((s) => { s.channels = remoteChannels; });
      return remoteChannels;
    }
  } catch (error) {
    console.warn("Unable to load remote channels, returning cached channels:", error);
  }
  return getState().channels;
}

export async function getChannel(id: string): Promise<Channel | undefined> {
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
      
      const members = (memberRows ?? []).map((row) => row.user_id);
      const allMembers = [channelRow.owner_id, ...members].filter((v, i, a) => a.indexOf(v) === i);
      const cached = getState().channels.find((c) => c.id === id);
      const remoteChannel = mapChannel(channelRow, allMembers);
      if (cached?.visibility) remoteChannel.visibility = cached.visibility;
      
      setState((s) => {
        const idx = s.channels.findIndex((c) => c.id === id);
        if (idx >= 0) s.channels[idx] = remoteChannel;
        else s.channels.push(remoteChannel);
      });
      return remoteChannel;
    }
  } catch (error) {
    console.warn("Unable to load remote channel, returning cached channel:", error);
  }
  return getState().channels.find((c) => c.id === id);
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

  const ch = mapChannel({ ...channelRow, visibility }, [input.ownerId]);
  publish("channels:changed");
  return ch;
}

export async function updateChannel(id: string, updates: { onlyAdminsPost?: boolean; adminIds?: string[]; name?: string; description?: string; avatar?: string; visibility?: "public" | "private" }) {
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

  if (Object.keys(updateData).length > 0) {
    const { error } = await supabase
      .from("channels")
      .update(updateData)
      .eq("id", id);

    if (error) throw new Error(error.message);
  }

  if (updates.visibility !== undefined) {
    setState((s) => {
      const channel = s.channels.find((c) => c.id === id);
      if (channel) channel.visibility = updates.visibility;
    });
  }

  publish("channels:changed");
}

export async function addChannelAdmin(channelId: string, userId: string) {
  // This would need admin tracking table - for now, just update cache
  setState((s) => {
    const ch = s.channels.find((c) => c.id === channelId);
    if (ch && !ch.adminIds.includes(userId)) {
      ch.adminIds.push(userId);
    }
  });
  publish("channels:changed");
}

export async function removeChannelAdmin(channelId: string, userId: string) {
  // This would need admin tracking table - for now, just update cache
  setState((s) => {
    const ch = s.channels.find((c) => c.id === channelId);
    if (ch) {
      ch.adminIds = ch.adminIds.filter((id) => id !== userId);
    }
  });
  publish("channels:changed");
}

export async function listPosts(channelId?: string): Promise<ChannelPost[]> {
  try {
    const supabase = ensureSupabase();
    let query = supabase.from("channel_posts").select("*");
    
    if (channelId) {
      query = query.eq("channel_id", channelId);
    }
    
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

      return mappedPosts;
    }
  } catch (error) {
    console.warn("Unable to load remote posts:", error);
  }
  
  const posts = channelId
    ? getState().channelPosts.filter((p) => p.channelId === channelId)
    : [...getState().channelPosts];
  return posts.sort((a, b) => b.createdAt - a.createdAt);
}

export async function getPost(id: string): Promise<ChannelPost | undefined> {
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

      return {
        id: post.id,
        channelId: post.channel_id,
        authorId: post.author_id,
        kind: post.kind,
        body: post.body,
        image: post.image_url,
        likes: reactions?.map((r: any) => r.user_id) ?? [],
        views: [], // Approximate
        createdAt: new Date(post.created_at).getTime(),
        boostedLikes: post.boosted_likes,
        boostedViews: post.boosted_views,
        pinned: post.pinned,
      };
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
  channelId: string; authorId: string; kind: "text" | "image"; body: string; image?: string;
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

    const { data: post, error } = await supabase
      .from("channel_posts")
      .insert([{
        channel_id: input.channelId,
        author_id: input.authorId,
        kind: input.kind,
        body: input.body,
        image_url: input.image,
      }])
      .select()
      .single();

    if (error || !post) throw new Error(error?.message || "Failed to create post");

    const mappedPost: ChannelPost = {
      id: post.id,
      channelId: post.channel_id,
      authorId: post.author_id,
      kind: post.kind,
      body: post.body,
      image: post.image_url,
      likes: [],
      views: [],
      createdAt: new Date(post.created_at).getTime(),
      boostedLikes: post.boosted_likes,
      boostedViews: post.boosted_views,
    };

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
    
    // Check if user already liked
    const { data: existing, error: checkError } = await supabase
      .from("channel_post_reactions")
      .select("*")
      .eq("post_id", postId)
      .eq("user_id", userId)
      .eq("emoji", "❤️")
      .single();

    if (checkError && checkError.code !== "PGRST116") {
      throw checkError;
    }

    if (existing) {
      // Remove like
      const { error: deleteError } = await supabase
        .from("channel_post_reactions")
        .delete()
        .eq("post_id", postId)
        .eq("user_id", userId)
        .eq("emoji", "❤️");

      if (deleteError) throw deleteError;
    } else {
      // Add like
      const { error: insertError } = await supabase
        .from("channel_post_reactions")
        .insert([{ post_id: postId, user_id: userId, emoji: "❤️" }]);

      if (insertError) throw insertError;
    }

    publish("channels:changed");
  } catch (error) {
    console.error("Failed to toggle like:", error);
  }
}

export async function markPostViewed(postId: string, sessionId: string) {
  try {
    const supabase = ensureSupabase();
    
    // Update post view count
    const { data: post } = await supabase
      .from("channel_posts")
      .select("view_count")
      .eq("id", postId)
      .single();

    if (post) {
      const { error } = await supabase
        .from("channel_posts")
        .update({ view_count: (post.view_count || 0) + 1 })
        .eq("id", postId);

      if (error) console.warn("Failed to mark view:", error);
    }
  } catch (error) {
    console.warn("Failed to mark post viewed:", error);
  }
}

export async function deletePost(postId: string) {
  try {
    const supabase = ensureSupabase();
    const { error } = await supabase
      .from("channel_posts")
      .delete()
      .eq("id", postId);

    if (error) throw error;
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

export async function listComments(postId: string): Promise<Comment[]> {
  return getState().comments.filter((c) => c.postId === postId).sort((a, b) => a.createdAt - b.createdAt);
}

export async function addComment(input: { postId: string; authorId: string; body: string }) {
  const c: Comment = { id: uid(), ...input, createdAt: Date.now() };
  setState((s) => { s.comments.push(c); });
  publish(`comments:${input.postId}`);
  return c;
}

export function subscribeToChannels(cb: () => void) {
  try {
    const supabase = ensureSupabase();
    const channel = supabase.channel("channels");
    channel.on("postgres_changes", { event: "*", schema: "public", table: "channels" }, () => cb());
    channel.on("postgres_changes", { event: "*", schema: "public", table: "channel_members" }, () => cb());
    channel.on("postgres_changes", { event: "*", schema: "public", table: "channel_posts" }, () => cb());
    channel.subscribe();

    return () => {
      channel.unsubscribe();
    };
  } catch (error) {
    console.warn("Unable to subscribe to channel updates:", error);
    return () => undefined;
  }
}

export function subscribeToComments(postId: string, cb: () => void) {
  return subscribe(`comments:${postId}`, cb);
}

export function likeCount(p: ChannelPost) {
  return p.likes.length + (p.boostedLikes || 0);
}

export function viewCount(p: ChannelPost) {
  return p.views.length + (p.boostedViews || 0);
}

function isVisibilitySchemaError(error: any) {
  const message = `${error?.message ?? ""} ${error?.details ?? ""}`.toLowerCase();
  return message.includes("column") && message.includes("does not exist");
}

function ensureJoinRequestList(requests?: JoinRequest[]) {
  return requests?.filter((req) => req.status === "pending") ?? [];
}

export async function requestJoinChannel(channelId: string, userId: string) {
  const channel = getState().channels.find((item) => item.id === channelId);
  if (!channel) throw new Error("Channel not found");
  if (channel.memberIds.includes(userId)) {
    throw new Error("You are already subscribed to this channel.");
  }

  const pending = ensureJoinRequestList(channel.joinRequests).find((req) => req.userId === userId);
  if (pending) {
    throw new Error("Your join request is already pending approval.");
  }

  setState((s) => {
    const target = s.channels.find((item) => item.id === channelId);
    if (!target) return;
    target.joinRequests = [
      ...(target.joinRequests ?? []),
      { userId, requestedAt: Date.now(), status: "pending" },
    ];
  });

  publish("channels:changed");
}

export async function approveJoinChannelRequest(channelId: string, userId: string) {
  setState((s) => {
    const target = s.channels.find((item) => item.id === channelId);
    if (!target) return;
    target.joinRequests = (target.joinRequests ?? []).filter((req) => req.userId !== userId);
    if (!target.memberIds.includes(userId)) target.memberIds.push(userId);
  });

  publish("channels:changed");
}

export async function rejectJoinChannelRequest(channelId: string, userId: string) {
  setState((s) => {
    const target = s.channels.find((item) => item.id === channelId);
    if (!target) return;
    target.joinRequests = (target.joinRequests ?? []).filter((req) => req.userId !== userId);
  });

  publish("channels:changed");
}

