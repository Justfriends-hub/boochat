import { getState, setState, uid, type Boost, type AuditLog, type Report } from "@/lib/mockStore";
import { publish } from "@/lib/eventBus";

function audit(entry: Omit<AuditLog, "id" | "createdAt">) {
  setState((s) => {
    s.auditLogs.push({ id: uid(), createdAt: Date.now(), ...entry });
  });
  publish("audit:changed");
}

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

export async function toggleBan(userId: string, adminId: string) {
  let banned = false;
  setState((s) => {
    const u = s.users.find((x) => x.id === userId);
    if (u) { u.banned = !u.banned; banned = !!u.banned; }
  });
  audit({ adminId, action: banned ? "ban_user" : "unban_user", targetType: "user", targetId: userId });
  publish("users:changed");
}

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

export async function listBoosts(): Promise<Boost[]> {
  return [...getState().boosts].sort((a, b) => b.createdAt - a.createdAt);
}
export async function listAuditLogs(): Promise<AuditLog[]> {
  return [...getState().auditLogs].sort((a, b) => b.createdAt - a.createdAt);
}
export async function listReports(): Promise<Report[]> {
  return [...getState().reports].sort((a, b) => b.createdAt - a.createdAt);
}

// Seed some reports if empty
export function seedAdminExtras() {
  const s = getState();
  if (s.reports.length === 0 && s.users.length > 0) {
    setState((st) => {
      st.reports.push(
        { id: uid(), reporterId: s.users[1].id, targetType: "post", targetId: s.channelPosts[0]?.id || "x", reason: "Spam", createdAt: Date.now() - 3600_000, status: "open" },
        { id: uid(), reporterId: s.users[2].id, targetType: "user", targetId: s.users[3].id, reason: "Harassment", createdAt: Date.now() - 7200_000, status: "open" },
        { id: uid(), reporterId: s.users[4].id, targetType: "channel", targetId: s.channels[0]?.id || "x", reason: "Misinformation", createdAt: Date.now() - 86400_000, status: "resolved" },
      );
    });
  }
}
