import { getState, setState, uid, type Boost, type AuditLog, type Report } from "@/lib/mockStore";
import { publish } from "@/lib/eventBus";

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
    views: s.channelPosts.reduce((a, p) => a + p.views.length + (p.boostedViews || 0), 0),
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
  setState((s) => {
    const u = s.users.find((x) => x.id === userId);
    if (u) { u.banned = !u.banned; banned = !!u.banned; }
  });
  audit({ adminId, action: banned ? "ban_user" : "unban_user", targetType: "user", targetId: userId });
  publish("users:changed");
}

export async function editUserProfile(
  userId: string,
  adminId: string,
  fields: { displayName?: string; bio?: string; avatar?: string; role?: "user" | "admin" | "superadmin" },
) {
  setState((s) => {
    const u = s.users.find((x) => x.id === userId);
    if (!u) return;
    if (fields.displayName !== undefined) u.displayName = fields.displayName;
    if (fields.bio !== undefined) u.bio = fields.bio;
    if (fields.avatar !== undefined) u.avatar = fields.avatar;
    if (fields.role !== undefined) u.role = fields.role;
  });
  audit({ adminId, action: "edit_user", targetType: "user", targetId: userId, meta: fields });
  publish("users:changed");
}

export async function resetUserPassword(userId: string, adminId: string) {
  const tempPassword = `reset_${Math.random().toString(36).slice(2, 10)}`;
  setState((s) => {
    const u = s.users.find((x) => x.id === userId);
    if (u) u.password = tempPassword;
  });
  audit({ adminId, action: "reset_password", targetType: "user", targetId: userId, meta: { tempPassword } });
  publish("users:changed");
  return tempPassword;
}

export async function forceLogoutUser(userId: string, adminId: string) {
  setState((s) => {
    const u = s.users.find((x) => x.id === userId);
    if (u) { u.online = false; u.forcedLogout = true; }
    // Clear session if this user is logged in
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
  setState((s) => {
    s.chats = s.chats.filter((c) => c.id !== groupId);
    s.messages = s.messages.filter((m) => m.chatId !== groupId);
  });
  audit({ adminId, action: "delete_group", targetType: "group", targetId: groupId });
  publish("chats:changed");
}

export async function removeGroupMember(groupId: string, userId: string, adminId: string) {
  setState((s) => {
    const g = s.chats.find((c) => c.id === groupId && c.type === "group");
    if (g) g.memberIds = g.memberIds.filter((id) => id !== userId);
  });
  audit({ adminId, action: "remove_group_member", targetType: "group", targetId: groupId, meta: { userId } });
  publish("chats:changed");
}

export async function transferGroupOwnership(groupId: string, newOwnerId: string, adminId: string) {
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
  setState((s) => {
    const p = s.channelPosts.find((x) => x.id === input.postId);
    if (!p) throw new Error("Post not found.");
    if (input.kind === "likes") p.boostedLikes = (p.boostedLikes || 0) + input.amount;
    else p.boostedViews = (p.boostedViews || 0) + input.amount;
  });
  const boost: Boost = {
    id: uid(), adminId: input.adminId, postId: input.postId,
    kind: input.kind, amount: input.amount, createdAt: Date.now(),
  };
  setState((s) => { s.boosts.push(boost); });
  audit({
    adminId: input.adminId, action: "boost_post",
    targetType: "post", targetId: input.postId,
    meta: { kind: input.kind, amount: input.amount },
  });
  publish("channels:changed");
  publish("boosts:changed");
  return boost;
}

export async function deletePostAsAdmin(postId: string, adminId: string) {
  setState((s) => { s.channelPosts = s.channelPosts.filter((p) => p.id !== postId); });
  audit({ adminId, action: "delete_post", targetType: "post", targetId: postId });
  publish("channels:changed");
}

export async function editChannel(
  channelId: string,
  adminId: string,
  fields: { name?: string; description?: string; ownerId?: string },
) {
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
  setState((s) => {
    s.channels = s.channels.filter((c) => c.id !== channelId);
    s.channelPosts = s.channelPosts.filter((p) => p.channelId !== channelId);
  });
  audit({ adminId, action: "delete_channel", targetType: "channel", targetId: channelId });
  publish("channels:changed");
}

export async function pinPost(postId: string, adminId: string) {
  setState((s) => {
    const p = s.channelPosts.find((x) => x.id === postId);
    if (p) p.pinned = true;
  });
  audit({ adminId, action: "pin_post", targetType: "post", targetId: postId });
  publish("channels:changed");
}

export async function unpinPost(postId: string, adminId: string) {
  setState((s) => {
    const p = s.channelPosts.find((x) => x.id === postId);
    if (p) p.pinned = false;
  });
  audit({ adminId, action: "unpin_post", targetType: "post", targetId: postId });
  publish("channels:changed");
}
