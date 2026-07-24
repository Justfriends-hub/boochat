import { getState, setState, uid, type Boost, type AuditLog, type Report, normalizeRole, type Role } from "@/lib/mockStore";
import { publish } from "@/lib/eventBus";
import { ensureSupabase } from "@/lib/supabaseClient";

// ─── Internal audit helper ─────────────────────────────────────────────────
function audit(entry: Omit<AuditLog, "id" | "createdAt">) {
  setState((s) => {
    s.auditLogs.push({ id: uid(), createdAt: Date.now(), ...entry });
  });
  publish("audit:changed");
}

// ─── System ───────────────────────────────────────────────────────────────

export async function overviewStats() {
  const s = getState();
  return {
    users: s.users.length,
    chats: s.chats.filter((c) => c.type === "dm").length,
    groups: s.chats.filter((c) => c.type === "group").length,
    channels: s.channels.length,
    posts: s.channelPosts.length,
    statuses: s.statuses.length,
    likes: s.channelPosts.reduce((a, p) => a + p.likes.length + (p.boostedLikes || 0), 0),
    realLikes: s.channelPosts.reduce((a, p) => a + p.likes.length, 0),
    boostedLikes: s.channelPosts.reduce((a, p) => a + (p.boostedLikes || 0), 0),
    views: s.channelPosts.reduce((a, p) => a + p.views.length + (p.boostedViews || 0), 0),
    realViews: s.channelPosts.reduce((a, p) => a + p.views.length, 0),
    boostedViews: s.channelPosts.reduce((a, p) => a + (p.boostedViews || 0), 0),
    boosts: s.boosts.length,
    reports: s.reports.length,
  };
}

export async function listBoosts(): Promise<Boost[]> {
  return [...getState().boosts].sort((a, b) => b.createdAt - a.createdAt);
}
export async function listAuditLogs(): Promise<AuditLog[]> {
  return [...getState().auditLogs].sort((a, b) => b.createdAt - a.createdAt);
}
export async function listReports(): Promise<Report[]> {
  return [...getState().reports].sort((a, b) => b.createdAt - a.createdAt);
}

export async function updateReportStatus(
  reportId: string,
  adminId: string,
  status: "open" | "resolved",
) {
  setState((s) => {
    const r = s.reports.find((x) => x.id === reportId);
    if (r) r.status = status;
  });
  audit({ adminId, action: status === "resolved" ? "resolve_report" : "reopen_report", targetType: "report", targetId: reportId });
  publish("reports:changed");
}

export function exportAuditLog(filters: {
  action?: string; adminId?: string; from?: number; to?: number;
}): string {
  const logs = getState().auditLogs
    .filter((l) => {
      if (filters.action && l.action !== filters.action) return false;
      if (filters.adminId && l.adminId !== filters.adminId) return false;
      if (filters.from && l.createdAt < filters.from) return false;
      if (filters.to && l.createdAt > filters.to) return false;
      return true;
    })
    .sort((a, b) => b.createdAt - a.createdAt);

  const header = "id,adminId,action,targetType,targetId,createdAt\n";
  const rows = logs.map((l) =>
    `${l.id},${l.adminId},${l.action},${l.targetType},${l.targetId},${new Date(l.createdAt).toISOString()}`,
  ).join("\n");
  return header + rows;
}

// Seed some reports if empty
export function seedAdminExtras() {
  const s = getState();
  if (s.reports.length === 0 && s.users.length > 0) {
    setState((st) => {
      st.reports.push(
        { id: uid(), reporterId: s.users[1]?.id || "u1", targetType: "post", targetId: s.channelPosts[0]?.id || "x", reason: "Spam", createdAt: Date.now() - 3600_000, status: "open" },
        { id: uid(), reporterId: s.users[2]?.id || "u2", targetType: "user", targetId: s.users[3]?.id || "u3", reason: "Harassment", createdAt: Date.now() - 7200_000, status: "open" },
        { id: uid(), reporterId: s.users[4]?.id || "u4", targetType: "channel", targetId: s.channels[0]?.id || "x", reason: "Misinformation", createdAt: Date.now() - 86400_000, status: "resolved" },
      );
    });
  }
}

// ─── Users ────────────────────────────────────────────────────────────────

export async function toggleBan(userId: string, adminId: string) {
  let banned = false;
  try {
    const client = ensureSupabase();
    // read current value from DB then flip
    const { data: current, error: fetchErr } = await client.from("profiles").select("banned").eq("id", userId).single();
    if (fetchErr) throw fetchErr;
    banned = !((current?.banned) ?? false);
    const { error } = await client.from("profiles").update({ banned }).eq("id", userId);
    if (error) throw error;
  } catch (err) {
    console.warn("toggleBan: supabase update failed, falling back to local store:", err);
    // fallback to local store
    setState((s) => {
      const u = s.users.find((x) => x.id === userId);
      if (u) { u.banned = !u.banned; banned = !!u.banned; }
    });
  }
  audit({ adminId, action: banned ? "ban_user" : "unban_user", targetType: "user", targetId: userId });
  publish("users:changed");
}

export async function editUserProfile(
  userId: string,
  adminId: string,
  fields: { displayName?: string; bio?: string; avatar?: string; role?: Role },
) {
  try {
    const client = ensureSupabase();
    const update: Record<string, any> = {};
    if (fields.displayName !== undefined) update.display_name = fields.displayName;
    if (fields.bio !== undefined) update.bio = fields.bio;
    if (fields.avatar !== undefined) update.avatar_url = fields.avatar;
    const { error } = await client.from("profiles").update(update).eq("id", userId);
    if (error) throw error;

    if (fields.role !== undefined) {
      const normalizedRole = normalizeRole(fields.role);
      const { error: roleError } = await client.from("user_roles").upsert({ user_id: userId, role: normalizedRole }, { onConflict: "user_id" });
      if (roleError) throw roleError;
    }

    // Update local cache for instant UI
    setState((s) => {
      const u = s.users.find((x) => x.id === userId);
      if (!u) return;
      if (fields.displayName !== undefined) u.displayName = fields.displayName;
      if (fields.bio !== undefined) u.bio = fields.bio;
      if (fields.avatar !== undefined) u.avatar = fields.avatar;
      if (fields.role !== undefined) u.role = normalizeRole(fields.role);
    });
  } catch (err) {
    console.warn("editUserProfile: supabase update failed, applying locally:", err);
    setState((s) => {
      const u = s.users.find((x) => x.id === userId);
      if (!u) return;
      if (fields.displayName !== undefined) u.displayName = fields.displayName;
      if (fields.bio !== undefined) u.bio = fields.bio;
      if (fields.avatar !== undefined) u.avatar = fields.avatar;
      if (fields.role !== undefined) u.role = normalizeRole(fields.role);
    });
  }
  audit({ adminId, action: "edit_user", targetType: "user", targetId: userId, meta: fields });
  publish("users:changed");
}

export async function resetUserPassword(userId: string, adminId: string) {
  // NOTE: resetting a user's auth password requires the Supabase service_role key
  // and must be performed server-side (Edge Function / serverless) — the client
  // cannot perform this securely. We attempt to call a configured admin function
  // endpoint and fall back to a local temp password for offline/dev mode.
  const fnUrl = import.meta.env.VITE_SUPABASE_ADMIN_RESET_PASSWORD_URL;
  if (fnUrl) {
    try {
      // Get the current user's session token from Supabase Auth
      const supabase = ensureSupabase();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) {
        throw new Error("No valid session found. User must be logged in.");
      }

      // Call the serverless function with the session token for authentication
      const res = await fetch(fnUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ userId }),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || `Reset function returned ${res.status}`);
      }

      const json = await res.json();
      const tempPassword = json?.tempPassword;
      audit({
        adminId,
        action: "reset_password",
        targetType: "user",
        targetId: userId,
        meta: { via: "edge_fn" },
      });
      publish("users:changed");
      return tempPassword;
    } catch (err: any) {
      console.warn("resetUserPassword: edge function failed:", err.message || err);
    }
  }

  // Fallback for dev/offline: generate a temporary password locally (NOT secure)
  const tempPassword = `reset_${Math.random().toString(36).slice(2, 10)}`;
  audit({
    adminId,
    action: "reset_password",
    targetType: "user",
    targetId: userId,
    meta: { via: "local_fallback" },
  });
  publish("users:changed");
  return tempPassword;
}

export async function forceLogoutUser(userId: string, adminId: string) {
  try {
    const client = ensureSupabase();
    const { error } = await client.from("profiles").update({ online: false, forced_logout: true }).eq("id", userId);
    if (error) throw error;
  } catch (err) {
    console.warn("forceLogoutUser: supabase update failed, applying locally:", err);
  }
  setState((s) => {
    const u = s.users.find((x) => x.id === userId);
    if (u) { u.online = false; (u as any).forcedLogout = true; }
    if (s.session?.userId === userId) s.session = null;
  });
  audit({ adminId, action: "force_logout", targetType: "user", targetId: userId });
  publish("users:changed");
}

// ─── Groups ───────────────────────────────────────────────────────────────

export async function editGroup(
  groupId: string,
  adminId: string,
  fields: { name?: string; avatar?: string },
) {
  try {
    const client = ensureSupabase();
    // update chats table and groups metadata if present
    const chatUpdate: Record<string, any> = {};
    if (fields.name !== undefined) chatUpdate.name = fields.name;
    if (fields.avatar !== undefined) chatUpdate.avatar_url = fields.avatar;
    if (Object.keys(chatUpdate).length) {
      const { error } = await client.from("chats").update(chatUpdate).eq("id", groupId);
      if (error) throw error;
    }
    const groupUpdate: Record<string, any> = {};
    if (fields.name !== undefined) groupUpdate.name = fields.name;
    if (fields.avatar !== undefined) groupUpdate.avatar_url = fields.avatar;
    if (Object.keys(groupUpdate).length) {
      await client.from("groups").update(groupUpdate).eq("chat_id", groupId);
    }
  } catch (err) {
    console.warn("editGroup: supabase update failed, applying locally:", err);
  }
  setState((s) => {
    const g = s.chats.find((c) => c.id === groupId && c.type === "group");
    if (!g) return;
    if (fields.name !== undefined) g.name = fields.name;
    if (fields.avatar !== undefined) g.avatar = fields.avatar;
  });
  audit({ adminId, action: "edit_group", targetType: "group", targetId: groupId, meta: fields });
  publish("chats:changed");
}

export async function deleteGroup(groupId: string, adminId: string) {
  try {
    const client = ensureSupabase();
    // Delete group metadata, members, messages and chat row where possible
    await client.from("group_members").delete().eq("group_id", groupId).throwOnError();
    await client.from("groups").delete().eq("chat_id", groupId).throwOnError();
    await client.from("chat_members").delete().eq("chat_id", groupId).throwOnError();
    await client.from("messages").delete().eq("chat_id", groupId).throwOnError();
    await client.from("chats").delete().eq("id", groupId).throwOnError();
  } catch (err) {
    console.warn("deleteGroup: supabase delete failed, applying locally:", err);
  }
  setState((s) => {
    s.chats = s.chats.filter((c) => c.id !== groupId);
    s.messages = s.messages.filter((m) => m.chatId !== groupId);
  });
  audit({ adminId, action: "delete_group", targetType: "group", targetId: groupId });
  publish("chats:changed");
}

export async function removeGroupMember(groupId: string, userId: string, adminId: string) {
  try {
    const client = ensureSupabase();
    await client.from("chat_members").delete().eq("chat_id", groupId).eq("user_id", userId);
    // Also remove from group_members if exists
    const { data: groupRow } = await client.from("groups").select("id").eq("chat_id", groupId).single();
    if (groupRow) {
      await client.from("group_members").delete().eq("group_id", groupRow.id).eq("user_id", userId);
    }
  } catch (err) {
    console.warn("removeGroupMember: supabase delete failed, applying locally:", err);
  }
  setState((s) => {
    const g = s.chats.find((c) => c.id === groupId && c.type === "group");
    if (g) g.memberIds = g.memberIds.filter((id) => id !== userId);
  });
  audit({ adminId, action: "remove_group_member", targetType: "group", targetId: groupId, meta: { userId } });
  publish("chats:changed");
}

export async function transferGroupOwnership(groupId: string, newOwnerId: string, adminId: string) {
  try {
    const client = ensureSupabase();
    await client.from("groups").update({ owner_id: newOwnerId }).eq("chat_id", groupId);
  } catch (err) {
    console.warn("transferGroupOwnership: supabase update failed, applying locally:", err);
  }
  setState((s) => {
    const g = s.chats.find((c) => c.id === groupId && c.type === "group");
    if (!g) return;
    g.ownerId = newOwnerId;
    if (!g.admins?.includes(newOwnerId)) g.admins = [...(g.admins ?? []), newOwnerId];
    if (!g.memberIds.includes(newOwnerId)) g.memberIds.push(newOwnerId);
  });
  audit({ adminId, action: "transfer_group_ownership", targetType: "group", targetId: groupId, meta: { newOwnerId } });
  publish("chats:changed");
}

// ─── Channels ─────────────────────────────────────────────────────────────

export async function boostPost(input: {
  adminId: string; postId: string; kind: "likes" | "views"; amount: number;
}): Promise<Boost> {
  if (input.amount <= 0) throw new Error("Boost amount must be greater than zero.");
  try {
    const client = ensureSupabase();
    // insert boost record
    const { data, error } = await client.from("boosts").insert([{ admin_id: input.adminId, post_id: input.postId, kind: input.kind, amount: input.amount }]).select().single();
    if (error) throw error;
    const boost: Boost = { id: data.id || uid(), adminId: input.adminId, postId: input.postId, kind: input.kind, amount: input.amount, createdAt: Date.now() };
    // update local cache
    setState((s) => { const p = s.channelPosts.find((x) => x.id === input.postId); if (p) { if (input.kind === "likes") p.boostedLikes = (p.boostedLikes || 0) + input.amount; else p.boostedViews = (p.boostedViews || 0) + input.amount; } s.boosts.push(boost); });
    audit({ adminId: input.adminId, action: "boost_post", targetType: "post", targetId: input.postId, meta: { kind: input.kind, amount: input.amount } });
    publish("channels:changed");
    publish("boosts:changed");
    return boost;
  } catch (err) {
    console.warn("boostPost: supabase insert failed, applying locally:", err);
    const boost: Boost = {
      id: uid(), adminId: input.adminId, postId: input.postId,
      kind: input.kind, amount: input.amount, createdAt: Date.now(),
    };
    setState((s) => { const p = s.channelPosts.find((x) => x.id === input.postId); if (p) { if (input.kind === "likes") p.boostedLikes = (p.boostedLikes || 0) + input.amount; else p.boostedViews = (p.boostedViews || 0) + input.amount; } s.boosts.push(boost); });
    audit({ adminId: input.adminId, action: "boost_post", targetType: "post", targetId: input.postId, meta: { kind: input.kind, amount: input.amount } });
    publish("channels:changed");
    publish("boosts:changed");
    return boost;
  }
}

export async function deletePostAsAdmin(postId: string, adminId: string) {
  try {
    const client = ensureSupabase();
    await client.from("channel_posts").delete().eq("id", postId);
  } catch (err) {
    console.warn("deletePostAsAdmin: supabase delete failed, applying locally:", err);
  }
  setState((s) => { s.channelPosts = s.channelPosts.filter((p) => p.id !== postId); });
  audit({ adminId, action: "delete_post", targetType: "post", targetId: postId });
  publish("channels:changed");
}

export async function editChannel(
  channelId: string,
  adminId: string,
  fields: { name?: string; description?: string; ownerId?: string },
) {
  try {
    const client = ensureSupabase();
    const update: Record<string, any> = {};
    if (fields.name !== undefined) update.name = fields.name;
    if (fields.description !== undefined) update.description = fields.description;
    if (fields.ownerId !== undefined) update.owner_id = fields.ownerId;
    if (Object.keys(update).length) {
      const { error } = await client.from("channels").update(update).eq("id", channelId);
      if (error) throw error;
    }
  } catch (err) {
    console.warn("editChannel: supabase update failed, applying locally:", err);
  }
  setState((s) => {
    const ch = s.channels.find((c) => c.id === channelId);
    if (!ch) return;
    if (fields.name !== undefined) ch.name = fields.name;
    if (fields.description !== undefined) ch.description = fields.description;
    if (fields.ownerId !== undefined) {
      ch.ownerId = fields.ownerId;
      if (!ch.adminIds.includes(fields.ownerId)) ch.adminIds.push(fields.ownerId);
    }
  });
  audit({ adminId, action: "edit_channel", targetType: "channel", targetId: channelId, meta: fields });
  publish("channels:changed");
}

export async function deleteChannel(channelId: string, adminId: string) {
  try {
    const client = ensureSupabase();
    await client.from("channel_posts").delete().eq("channel_id", channelId);
    await client.from("channels").delete().eq("id", channelId);
  } catch (err) {
    console.warn("deleteChannel: supabase delete failed, applying locally:", err);
  }
  setState((s) => {
    s.channels = s.channels.filter((c) => c.id !== channelId);
    s.channelPosts = s.channelPosts.filter((p) => p.channelId !== channelId);
  });
  audit({ adminId, action: "delete_channel", targetType: "channel", targetId: channelId });
  publish("channels:changed");
}

export async function pinPost(postId: string, adminId: string) {
  try {
    const client = ensureSupabase();
    await client.from("channel_posts").update({ pinned: true }).eq("id", postId);
  } catch (err) {
    console.warn("pinPost: supabase update failed, applying locally:", err);
  }
  setState((s) => {
    const p = s.channelPosts.find((x) => x.id === postId);
    if (p) p.pinned = true;
  });
  audit({ adminId, action: "pin_post", targetType: "post", targetId: postId });
  publish("channels:changed");
}

export async function unpinPost(postId: string, adminId: string) {
  try {
    const client = ensureSupabase();
    await client.from("channel_posts").update({ pinned: false }).eq("id", postId);
  } catch (err) {
    console.warn("unpinPost: supabase update failed, applying locally:", err);
  }
  setState((s) => {
    const p = s.channelPosts.find((x) => x.id === postId);
    if (p) p.pinned = false;
  });
  audit({ adminId, action: "unpin_post", targetType: "post", targetId: postId });
  publish("channels:changed");
}
