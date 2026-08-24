import { getState, setState, uid, type Boost, type AuditLog, type Report, normalizeRole, type Role } from "@/lib/mockStore";
import { publish } from "@/lib/eventBus";
import { ensureSupabase, supabaseConfigured } from "@/lib/supabaseClient";
import { deleteChannel as deleteChannelCascade } from "@/api/channelsApi";
import { toast } from "sonner";

// ─── Internal helpers ───────────────────────────────────────────────────────
/**
 * A mutation failed to reach the server and was only applied to this device's
 * local cache. Surface it honestly instead of letting success toasts lie.
 */
function warnLocalOnly(what: string) {
  toast.warning(
    `${what} was saved on this device only — the server could not be reached. It may not sync.`,
    { duration: 6000 },
  );
}

/**
 * Append an audit entry. The local store keeps the panel working offline;
 * the durable record lives in the server-side audit_logs table.
 */
function audit(entry: Omit<AuditLog, "id" | "createdAt">) {
  setState((s) => {
    s.auditLogs.push({ id: uid(), createdAt: Date.now(), ...entry });
  });
  try {
    const client = ensureSupabase();
    void client
      .from("audit_logs")
      .insert({
        admin_id: entry.adminId,
        action: entry.action,
        target_type: entry.targetType,
        target_id: entry.targetId || null,
        meta: (entry.meta ?? {}) as Record<string, unknown>,
      })
      .then(({ error }) => {
        if (error) console.warn("audit: remote insert failed:", error.message);
      });
  } catch (err) {
    console.warn("audit: supabase unavailable, kept locally only:", err);
  }
  publish("audit:changed");
}

// ─── System ───────────────────────────────────────────────────────────────

export async function overviewStats() {
  const s = getState();
  const realViews = (p: { views: string[]; realViewCount?: number }) =>
    p.realViewCount ?? p.views.length;
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
    views: s.channelPosts.reduce((a, p) => a + realViews(p) + (p.boostedViews || 0), 0),
    realViews: s.channelPosts.reduce((a, p) => a + realViews(p), 0),
    boostedViews: s.channelPosts.reduce((a, p) => a + (p.boostedViews || 0), 0),
    boosts: s.boosts.length,
    reports: s.reports.length,
  };
}

export async function listBoosts(): Promise<Boost[]> {
  try {
    const client = ensureSupabase();
    const { data, error } = await client
      .from("admin_boosts")
      .select("id,admin_id,post_id,kind,amount,created_at")
      .order("created_at", { ascending: false })
      .limit(200);
    if (!error && data) {
      return (data as any[]).map((row) => ({
        id: row.id,
        adminId: row.admin_id,
        postId: row.post_id,
        kind: row.kind,
        amount: row.amount,
        createdAt: new Date(row.created_at).getTime(),
      }));
    }
  } catch (err) {
    console.warn("listBoosts: supabase query failed, falling back to local:", err);
  }
  return [...getState().boosts].sort((a, b) => b.createdAt - a.createdAt);
}
export async function listAuditLogs(): Promise<AuditLog[]> {
  try {
    const client = ensureSupabase();
    const { data, error } = await client
      .from("audit_logs")
      .select("id,admin_id,action,target_type,target_id,meta,created_at")
      .order("created_at", { ascending: false })
      .limit(200);
    if (!error && data) {
      return (data as any[]).map((row) => ({
        id: row.id,
        adminId: row.admin_id,
        action: row.action,
        targetType: row.target_type,
        targetId: row.target_id ?? "",
        meta: row.meta ?? undefined,
        createdAt: new Date(row.created_at).getTime(),
      }));
    }
  } catch (err) {
    console.warn("listAuditLogs: supabase query failed, falling back to local:", err);
  }
  return [...getState().auditLogs].sort((a, b) => b.createdAt - a.createdAt);
}

function mapReportRow(row: any): Report {
  return {
    id: row.id,
    reporterId: row.reporter_id,
    targetType: row.target_type,
    targetId: row.target_id ?? "",
    reason: row.reason,
    status: row.status === "resolved" ? "resolved" : "open",
    createdAt: new Date(row.created_at).getTime(),
  };
}

export async function listReports(): Promise<Report[]> {
  try {
    const client = ensureSupabase();
    const { data, error } = await client
      .from("reports")
      .select("id,reporter_id,target_type,target_id,reason,status,created_at")
      .order("created_at", { ascending: false })
      .limit(200);
    if (!error && data) {
      return (data as any[]).map(mapReportRow);
    }
  } catch (err) {
    console.warn("listReports: supabase query failed, falling back to local:", err);
  }
  return [...getState().reports].sort((a, b) => b.createdAt - a.createdAt);
}

export async function updateReportStatus(
  reportId: string,
  adminId: string,
  status: "open" | "resolved",
) {
  let persisted = false;
  try {
    const client = ensureSupabase();
    const { error } = await client.from("reports").update({ status }).eq("id", reportId);
    if (!error) persisted = true;
    else console.warn("updateReportStatus: remote update failed:", error.message);
  } catch (err) {
    console.warn("updateReportStatus: supabase unavailable:", err);
  }
  setState((s) => {
    const r = s.reports.find((x) => x.id === reportId);
    if (r) r.status = status;
  });
  audit({ adminId, action: status === "resolved" ? "resolve_report" : "reopen_report", targetType: "report", targetId: reportId });
  publish("reports:changed");
  if (!persisted) warnLocalOnly("Report status");
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

// Seed demo reports ONLY when running without a backend (pure offline/demo
// mode). Fabricating reports in live deployments pollutes moderation state.
export function seedAdminExtras() {
  if (supabaseConfigured) return;
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
    warnLocalOnly("Ban state");
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
      // user_roles unique constraint is (user_id, role)
      const { error: roleError } = await client.from("user_roles").upsert({ user_id: userId, role: normalizedRole }, { onConflict: "user_id,role" });
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
    warnLocalOnly("Profile edit");
  }
  audit({ adminId, action: "edit_user", targetType: "user", targetId: userId, meta: fields });
  publish("users:changed");
}

export async function setUserUpgraded(userId: string, adminId: string, upgraded: boolean) {
  const fnUrl = import.meta.env.VITE_SUPABASE_ADMIN_SET_UPGRADED_URL ?? "/api/admin/set-upgraded";
  let success = false;
  let adminEndpointWorked = false;
  let adminEndpointError: string | null = null;

  try {
    const supabase = ensureSupabase();
    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession();
    if (sessionError) throw sessionError;
    if (!session?.access_token) throw new Error("No valid session found.");

    const res = await fetch(fnUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ userId, upgraded }),
    });

    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      adminEndpointError = json.error || `Admin update failed with status ${res.status}`;
      throw new Error(adminEndpointError ?? "Admin update failed");
    }

    adminEndpointWorked = true;
    success = true;
  } catch (err: any) {
    adminEndpointError = adminEndpointError || err?.message || String(err);
    console.warn("setUserUpgraded: admin function failed, falling back to direct update:", adminEndpointError);
    try {
      const client = ensureSupabase();
      const update: Record<string, any> = { is_upgraded: upgraded };
      if (upgraded) {
        update.upgraded_at = new Date().toISOString();
        update.upgraded_by = adminId;
      } else {
        update.upgraded_at = null;
        update.upgraded_by = null;
      }
      const { error } = await client.from("profiles").update(update).eq("id", userId);
      if (error) throw error;
      success = true;
    } catch (fallbackErr: any) {
      console.warn("setUserUpgraded: fallback update failed:", fallbackErr);
      throw new Error(
        `Failed to persist upgrade state to Supabase. Admin endpoint error: ${adminEndpointError || String(fallbackErr)}`,
      );
    }
  }

  if (success) {
    setState((s) => {
      const u = s.users.find((x) => x.id === userId);
      if (u) u.isUpgraded = upgraded;
    });
    audit({ adminId, action: upgraded ? "grant_upgrade" : "revoke_upgrade", targetType: "user", targetId: userId });
    publish("users:changed");
    return { adminEndpointWorked, adminEndpointError };
  }

  throw new Error("Failed to persist upgrade state to Supabase");
}

export async function listUpgradedUsers() {
  try {
    const client = ensureSupabase();
    const { data, error } = await client.from("profiles").select("id,email,display_name,upgraded_at,upgraded_by").eq("is_upgraded", true).order("upgraded_at", { ascending: false });
    if (!error && data) {
      return data;
    }
  } catch (err) {
    console.warn("listUpgradedUsers: supabase query failed, falling back to local:", err);
  }
  // Fallback: derive from local store
  return getState().users.filter((u) => (u as any).isUpgraded).map((u) => ({ id: u.id, email: u.email, display_name: u.displayName, upgraded_at: null, upgraded_by: null }));
}

export async function resetUserPassword(userId: string, adminId: string) {
  // NOTE: resetting a user's auth password requires the Supabase service_role key
  // and must be performed server-side (Edge Function / serverless) — the client
  // cannot perform this securely. We attempt to call a configured admin function
  // endpoint and fall back to a local temp password for offline/dev mode.
  const fnUrl = import.meta.env.VITE_SUPABASE_ADMIN_RESET_PASSWORD_URL ?? "/api/admin/reset-password";
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
  warnLocalOnly("Password reset — the server was unreachable, so the password was NOT actually changed");
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
    warnLocalOnly("Force logout");
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
    warnLocalOnly("Group edit");
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
    warnLocalOnly("Group deletion");
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
    warnLocalOnly("Member removal");
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
    warnLocalOnly("Ownership transfer");
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

  // Try server-side boosts with graceful degradation:
  // 1) boost_post (canonical in supabase.md)  2) apply_admin_boost (legacy alias)
  // 3) direct channel_posts increment  4) local-only fallback
  const tryRpc = async (fn: string, params: Record<string, unknown>) => {
    try {
      const client = ensureSupabase();
      const { error } = await (client as any).rpc(fn, params);
      return error ? { ok: false as const, error } : { ok: true as const, error: null };
    } catch (e: any) {
      return { ok: false as const, error: e };
    }
  };

  let serverApplied = false;
  let lastError: any = null;

  // 1) Canonical RPC from supabase.md
  {
    const r = await tryRpc("boost_post", {
      _post_type: "channel",
      _post_id: input.postId,
      _kind: input.kind,
      _amount: input.amount,
    });
    if (r.ok) serverApplied = true;
    else {
      // Also try the 3-arg variant without _post_type used by some deploys
      const r2 = await tryRpc("boost_post", {
        _post_id: input.postId,
        _kind: input.kind,
        _amount: input.amount,
      });
      if (r2.ok) serverApplied = true;
      else lastError = r.error ?? r2.error;
    }
  }

  // 2) Legacy alias
  if (!serverApplied) {
    const r = await tryRpc("apply_admin_boost", {
      p_post_id: input.postId,
      p_kind: input.kind,
      p_amount: input.amount,
    });
    if (r.ok) serverApplied = true;
    else lastError = r.error;
  }

  // 3) Direct table increment fallback (works even if RPC missing, if RLS allows)
  if (!serverApplied) {
    try {
      const client = ensureSupabase();
      const col = input.kind === "likes" ? "boosted_likes" : "boosted_views";
      const { data: row, error: fetchErr } = await client
        .from("channel_posts")
        .select(col)
        .eq("id", input.postId)
        .single();
      if (!fetchErr && row) {
        const current = Number((row as any)[col] ?? 0);
        const { error: updErr } = await client
          .from("channel_posts")
          .update({ [col]: current + input.amount })
          .eq("id", input.postId);
        if (!updErr) serverApplied = true;
        else lastError = updErr;
      } else if (fetchErr) {
        lastError = fetchErr;
      }
    } catch (e) {
      lastError = e;
    }
  }

  if (!serverApplied && lastError) {
    console.warn("boostPost: all server attempts failed, applying locally:", lastError?.message ?? lastError);
    // Not fatal — we still apply locally below. Only warnLocalOnly if we had a server error
    // that is not just "function not found / table not found" to avoid spamming.
    const msg = String(lastError?.message ?? lastError ?? "").toLowerCase();
    const isMissingFnOrTable = msg.includes("could not find") || msg.includes("does not exist") || msg.includes("function");
    if (!isMissingFnOrTable) warnLocalOnly("Boost");
  }

  const boost: Boost = {
    id: uid(), adminId: input.adminId, postId: input.postId,
    kind: input.kind, amount: input.amount, createdAt: Date.now(),
  };
  setState((s) => {
    const p = s.channelPosts.find((x) => x.id === input.postId);
    if (p) {
      if (input.kind === "likes") p.boostedLikes = (p.boostedLikes || 0) + input.amount;
      else p.boostedViews = (p.boostedViews || 0) + input.amount;
    }
    s.boosts.push(boost);
  });
  try {
    const { saveList: saveListFn } = await import("@/lib/offlineStore");
    saveListFn("channelPosts", getState().channelPosts);
  } catch {}
  audit({ adminId: input.adminId, action: "boost_post", targetType: "post", targetId: input.postId, meta: { kind: input.kind, amount: input.amount } });
  publish("channels:changed");
  publish("boosts:changed");
  return boost;
}

export async function deletePostAsAdmin(postId: string, adminId: string) {
  try {
    const client = ensureSupabase();
    await client.from("channel_posts").delete().eq("id", postId);
  } catch (err) {
    console.warn("deletePostAsAdmin: supabase delete failed, applying locally:", err);
    warnLocalOnly("Post deletion");
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
    warnLocalOnly("Channel edit");
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
    // Full cascade (posts, reactions, members, removed members, join requests, communities)
    await deleteChannelCascade(channelId);
  } catch (err) {
    console.warn("deleteChannel: supabase cascade failed, applying locally:", err);
    setState((s) => {
      s.channels = s.channels.filter((c) => c.id !== channelId);
      s.channelPosts = s.channelPosts.filter((p) => p.channelId !== channelId);
    });
    publish("channels:changed");
  }
  audit({ adminId, action: "delete_channel", targetType: "channel", targetId: channelId });
}

export async function pinPost(postId: string, adminId: string) {
  try {
    const client = ensureSupabase();
    await client.from("channel_posts").update({ pinned: true }).eq("id", postId);
  } catch (err) {
    console.warn("pinPost: supabase update failed, applying locally:", err);
    warnLocalOnly("Pin");
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
    warnLocalOnly("Unpin");
  }
  setState((s) => {
    const p = s.channelPosts.find((x) => x.id === postId);
    if (p) p.pinned = false;
  });
  audit({ adminId, action: "unpin_post", targetType: "post", targetId: postId });
  publish("channels:changed");
}
