import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import {
  Tabs, TabsList, TabsTrigger, TabsContent,
} from "@/components/ui/tabs";
import {
  Table, TableHeader, TableRow, TableHead, TableBody, TableCell,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { UserAvatar } from "@/components/UserAvatar";
import { BoostDialog } from "@/components/BoostDialog";
import { FeatureBoundary } from "@/components/FeatureBoundary";
import {
  overviewStats, toggleBan, deletePostAsAdmin,
  listBoosts, listAuditLogs, listReports, seedAdminExtras,
  editUserProfile, resetUserPassword, forceLogoutUser,
  editGroup, deleteGroup, removeGroupMember, transferGroupOwnership,
  editChannel, deleteChannel, pinPost, unpinPost, updateReportStatus,
  exportAuditLog,
} from "@/api/adminApi";
import { listUsers } from "@/api/usersApi";
import { listPosts, listChannels, subscribeToChannels } from "@/api/channelsApi";
import { subscribeToChats } from "@/api/chatsApi";
import { listActiveStatuses } from "@/api/statusApi";
import { getState, normalizeRole } from "@/lib/mockStore";
import { subscribe } from "@/lib/eventBus";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { timeAgo } from "@/lib/format";
import {
  Users, MessageCircle, Radio, Image as ImageIcon, Heart, Eye,
  TrendingUp, ShieldAlert, X, Pin, PinOff, Trash2, Edit2,
  LogOut, RefreshCw, Shield, UserMinus, Download,
} from "lucide-react";

const searchSchema = z.object({
  tab: z.string().optional().default("users"),
  au_user: z.string().optional().default(""),
  au_action: z.string().optional().default(""),
  au_from: z.string().optional().default(""),
  au_to: z.string().optional().default(""),
  bo_user: z.string().optional().default(""),
  bo_kind: z.string().optional().default(""),
  bo_from: z.string().optional().default(""),
  bo_to: z.string().optional().default(""),
});

export const Route = createFileRoute("/_app/admin")({
  validateSearch: (search) => {
    const result = searchSchema.safeParse(search);
    if (result.success) return result.data;
    return {
      tab: "users", au_user: "", au_action: "", au_from: "", au_to: "",
      bo_user: "", bo_kind: "", bo_from: "", bo_to: "",
    };
  },
  component: AdminPage,
  head: () => ({ meta: [{ title: "Admin — Boochat" }] }),
});

function toDayStart(s: string) { return s ? new Date(s + "T00:00:00").getTime() : null; }
function toDayEnd(s: string) { return s ? new Date(s + "T23:59:59.999").getTime() : null; }

function AdminPage() {
  const me = useAuth();
  const nav = useNavigate({ from: "/chats" });
  const search = Route.useSearch();
  const qc = useQueryClient();
  const [boostFor, setBoostFor] = useState<string | null>(null);
  const [editUserOpen, setEditUserOpen] = useState<string | null>(null);
  const [editGroupOpen, setEditGroupOpen] = useState<string | null>(null);
  const [editChannelOpen, setEditChannelOpen] = useState<string | null>(null);

  useEffect(() => {
    if (me && normalizeRole(me.role) !== "owner") nav({ to: "/chats" });
  }, [me, nav]);
  useEffect(() => { seedAdminExtras(); }, []);

  const { data: stats } = useQuery({ queryKey: ["admin.stats"], queryFn: overviewStats });
  const { data: users = [] } = useQuery({ queryKey: ["users"], queryFn: listUsers });
  const { data: posts = [] } = useQuery({ queryKey: ["admin.posts"], queryFn: () => listPosts() });
  const { data: channels = [] } = useQuery({ queryKey: ["admin.channels"], queryFn: listChannels });
  const { data: groups = [] } = useQuery({ queryKey: ["admin.groups"], queryFn: () => getState().chats.filter((c) => c.type === "group") });
  const { data: statuses = [] } = useQuery({ queryKey: ["admin.statuses"], queryFn: () => listActiveStatuses() });
  const { data: boosts = [] } = useQuery({ queryKey: ["admin.boosts"], queryFn: listBoosts });
  const { data: audits = [] } = useQuery({ queryKey: ["admin.audits"], queryFn: listAuditLogs });
  const { data: reports = [] } = useQuery({ queryKey: ["admin.reports"], queryFn: listReports });

  useEffect(() => subscribeToChannels(() => qc.invalidateQueries({ queryKey: ["admin.channels"] })), [qc]);
  useEffect(() => subscribeToChats(() => qc.invalidateQueries({ queryKey: ["admin.groups"] })), [qc]);
  useEffect(() => {
    const unsub = subscribe("store:seeded", () => qc.invalidateQueries({ queryKey: ["admin.channels", "admin.groups"] }));
    return unsub;
  }, [qc]);

  const setSearch = (patch: Record<string, string>) => {
    nav({
      search: ((prev: Record<string, string>) => {
        const next: Record<string, string> = { ...prev, ...patch };
        Object.keys(next).forEach((k) => { if (!next[k]) delete next[k]; });
        return next;
      }) as any,
      replace: true,
    });
  };

  const auditActions = useMemo(
    () => Array.from(new Set(audits.map((a) => a.action))).sort(),
    [audits],
  );

  const filteredAudits = useMemo(() => {
    const q = (search.au_user ?? "").toLowerCase().trim();
    const from = toDayStart(search.au_from ?? "");
    const to = toDayEnd(search.au_to ?? "");
    return audits.filter((a) => {
      if (search.au_action && a.action !== search.au_action) return false;
      if (from && a.createdAt < from) return false;
      if (to && a.createdAt > to) return false;
      if (q) {
        const u = users.find((x) => x.id === a.adminId);
        const hay = `${u?.displayName || ""} ${u?.email || ""} ${a.adminId}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [audits, users, search.au_user, search.au_action, search.au_from, search.au_to]);

  const filteredBoosts = useMemo(() => {
    const q = (search.bo_user ?? "").toLowerCase().trim();
    const from = toDayStart(search.bo_from ?? "");
    const to = toDayEnd(search.bo_to ?? "");
    return boosts.filter((b) => {
      if (search.bo_kind && b.kind !== search.bo_kind) return false;
      if (from && b.createdAt < from) return false;
      if (to && b.createdAt > to) return false;
      if (q) {
        const u = users.find((x) => x.id === b.adminId);
        const hay = `${u?.displayName || ""} ${u?.email || ""} ${b.adminId}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [boosts, users, search.bo_user, search.bo_kind, search.bo_from, search.bo_to]);

  if (!me || normalizeRole(me.role) !== "owner") return null;

  const statCards = [
    { label: "Users", value: stats?.users || 0, icon: Users },
    { label: "Chats", value: stats?.chats || 0, icon: MessageCircle },
    { label: "Groups", value: stats?.groups || 0, icon: Users },
    { label: "Channels", value: stats?.channels || 0, icon: Radio },
    { label: "Posts", value: stats?.posts || 0, icon: MessageCircle },
    { label: "Statuses", value: stats?.statuses || 0, icon: ImageIcon },
    { label: "Likes", value: stats?.likes || 0, icon: Heart },
    { label: "Real Views", value: stats?.realViews || 0, icon: Eye },
    { label: "Boosted Views", value: stats?.boostedViews || 0, icon: TrendingUp },
    { label: "Boosts", value: stats?.boosts || 0, icon: TrendingUp },
    { label: "Reports", value: stats?.reports || 0, icon: ShieldAlert },
  ];

  const auClear = () => setSearch({ au_user: "", au_action: "", au_from: "", au_to: "" });
  const boClear = () => setSearch({ bo_user: "", bo_kind: "", bo_from: "", bo_to: "" });
  const auActive = !!(search.au_user || search.au_action || search.au_from || search.au_to);
  const boActive = !!(search.bo_user || search.bo_kind || search.bo_from || search.bo_to);

  return (
    <FeatureBoundary name="admin">
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-16 items-center gap-3 border-b bg-card px-4">
          <Shield className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-semibold">Admin Panel</h1>
          <span className="ml-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary uppercase">
            {me.role}
          </span>
        </header>
        <div className="flex-1 overflow-y-auto p-4">
          <Tabs
            value={search.tab ?? "users"}
            onValueChange={(v) => setSearch({ tab: v })}
            className="w-full"
          >
            <TabsList className="mb-4 flex-wrap h-auto">
              <TabsTrigger value="users" className="gap-1.5"><Users className="h-3.5 w-3.5" />Users</TabsTrigger>
              <TabsTrigger value="groups" className="gap-1.5"><MessageCircle className="h-3.5 w-3.5" />Groups</TabsTrigger>
              <TabsTrigger value="channels" className="gap-1.5"><Radio className="h-3.5 w-3.5" />Channels</TabsTrigger>
              <TabsTrigger value="system" className="gap-1.5"><ShieldAlert className="h-3.5 w-3.5" />System</TabsTrigger>
            </TabsList>

            {/* ─── USERS TAB ──────────────────────────────────────────── */}
            <TabsContent value="users">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((u) => (
                    <TableRow key={u.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <UserAvatar name={u.displayName} src={u.avatar} size={28} />
                          {u.displayName}
                        </div>
                      </TableCell>
                      <TableCell>{u.email}</TableCell>
                      <TableCell>
                        <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-full ${
                          normalizeRole(u.role) === "owner" ? "bg-purple-100 text-purple-700" :
                          normalizeRole(u.role) === "member" ? "bg-blue-100 text-blue-700" :
                          "bg-muted text-muted-foreground"
                        }`}>
                          {normalizeRole(u.role)}
                        </span>
                      </TableCell>
                      <TableCell>
                        {u.banned ? <span className="text-destructive font-medium">Banned</span> : "Active"}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1.5 flex-wrap">
                          <Button size="sm" variant={u.banned ? "outline" : "destructive"}
                            onClick={async () => {
                              await toggleBan(u.id, me.id);
                              toast.success(u.banned ? "User unbanned" : "User banned");
                              qc.invalidateQueries({ queryKey: ["users"] });
                            }}>
                            {u.banned ? "Unban" : "Ban"}
                          </Button>
                          <Button size="sm" variant="outline" className="gap-1"
                            onClick={() => setEditUserOpen(u.id)}>
                            <Edit2 className="h-3 w-3" />
                          </Button>
                          <Button size="sm" variant="outline" className="gap-1"
                            title="Reset Password"
                            onClick={async () => {
                              const temp = await resetUserPassword(u.id, me.id);
                              toast.success(`Temp password: ${temp}`, { duration: 8000 });
                              qc.invalidateQueries({ queryKey: ["users"] });
                            }}>
                            <RefreshCw className="h-3 w-3" />
                          </Button>
                          <Button size="sm" variant="outline" className="gap-1"
                            title="Force Logout"
                            onClick={async () => {
                              await forceLogoutUser(u.id, me.id);
                              toast.success("User logged out");
                              qc.invalidateQueries({ queryKey: ["users"] });
                            }}>
                            <LogOut className="h-3 w-3" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TabsContent>

            {/* ─── GROUPS TAB ─────────────────────────────────────────── */}
            <TabsContent value="groups">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Group</TableHead>
                    <TableHead>Members</TableHead>
                    <TableHead>Owner</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {groups.map((g) => {
                    const owner = users.find((u) => u.id === g.ownerId);
                    return (
                      <TableRow key={g.id}>
                        <TableCell className="font-medium">{g.name || "Unnamed Group"}</TableCell>
                        <TableCell>{g.memberIds.length}</TableCell>
                        <TableCell>{owner?.displayName || g.ownerId}</TableCell>
                        <TableCell>
                          <div className="flex items-center justify-end gap-1.5 flex-wrap">
                            <Button size="sm" variant="outline" className="gap-1"
                              onClick={() => setEditGroupOpen(g.id)}>
                              <Edit2 className="h-3 w-3" /> Edit
                            </Button>
                            <Button size="sm" variant="destructive" className="gap-1"
                              onClick={async () => {
                                if (!confirm(`Delete group "${g.name}"? This cannot be undone.`)) return;
                                await deleteGroup(g.id, me.id);
                                toast.success("Group deleted");
                                qc.invalidateQueries();
                              }}>
                              <Trash2 className="h-3 w-3" /> Delete
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {groups.length === 0 && (
                    <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">No groups yet</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </TabsContent>

            {/* ─── CHANNELS TAB ───────────────────────────────────────── */}
            <TabsContent value="channels">
              <div className="space-y-6">
                {/* Channel list */}
                <div>
                  <h3 className="mb-2 font-semibold text-sm text-muted-foreground uppercase tracking-wide">Channels</h3>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Subscribers</TableHead>
                        <TableHead>Posts</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {channels.map((ch) => (
                        <TableRow key={ch.id}>
                          <TableCell className="font-medium">{ch.name}</TableCell>
                          <TableCell>{ch.memberIds.length}</TableCell>
                          <TableCell>{posts.filter((p) => p.channelId === ch.id).length}</TableCell>
                          <TableCell>
                            <div className="flex items-center justify-end gap-1.5 flex-wrap">
                              <Button size="sm" variant="outline" className="gap-1"
                                onClick={() => setEditChannelOpen(ch.id)}>
                                <Edit2 className="h-3 w-3" /> Edit
                              </Button>
                              <Button size="sm" variant="destructive" className="gap-1"
                                onClick={async () => {
                                  if (!confirm(`Delete channel "${ch.name}"? This cannot be undone.`)) return;
                                  await deleteChannel(ch.id, me.id);
                                  toast.success("Channel deleted");
                                  qc.invalidateQueries();
                                }}>
                                <Trash2 className="h-3 w-3" /> Delete
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                      {channels.length === 0 && (
                        <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">No channels yet</TableCell></TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>

                {/* Post list */}
                <div>
                  <h3 className="mb-2 font-semibold text-sm text-muted-foreground uppercase tracking-wide">Posts</h3>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Body</TableHead>
                        <TableHead>Real Likes</TableHead>
                        <TableHead>Boosted Likes</TableHead>
                        <TableHead>Real Views</TableHead>
                        <TableHead>Boosted Views</TableHead>
                        <TableHead>Pinned</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {posts.map((p) => (
                        <TableRow key={p.id} className={p.pinned ? "bg-primary/5" : ""}>
                          <TableCell className="max-w-xs truncate">{p.body}</TableCell>
                          <TableCell>{p.likes.length}</TableCell>
                          <TableCell>{p.boostedLikes || 0}</TableCell>
                          <TableCell>{p.views.length}</TableCell>
                          <TableCell>{p.boostedViews || 0}</TableCell>
                          <TableCell>{p.pinned ? <Pin className="h-4 w-4 text-primary" /> : "—"}</TableCell>
                          <TableCell>
                            <div className="flex items-center justify-end gap-1.5 flex-wrap">
                              <Button size="sm" variant="outline" onClick={() => setBoostFor(p.id)}>
                                <TrendingUp className="h-3 w-3 mr-1" /> Boost
                              </Button>
                              <Button size="sm" variant="outline"
                                onClick={async () => {
                                  if (p.pinned) {
                                    await unpinPost(p.id, me.id);
                                    toast.success("Post unpinned");
                                  } else {
                                    await pinPost(p.id, me.id);
                                    toast.success("Post pinned");
                                  }
                                  qc.invalidateQueries({ queryKey: ["admin.posts"] });
                                }}>
                                {p.pinned ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}
                              </Button>
                              <Button size="sm" variant="destructive"
                                onClick={async () => {
                                  await deletePostAsAdmin(p.id, me.id);
                                  toast.success("Post deleted");
                                  qc.invalidateQueries();
                                }}>
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </TabsContent>

            {/* ─── SYSTEM TAB ─────────────────────────────────────────── */}
            <TabsContent value="system">
              <div className="space-y-6">
                {/* Stats */}
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                  {statCards.map((s) => (
                    <Card key={s.label} className="p-4">
                      <div className="flex items-center gap-2 text-muted-foreground text-xs">
                        <s.icon className="h-4 w-4" aria-hidden="true" /> {s.label}
                      </div>
                      <p className="mt-1 text-2xl font-semibold">{s.value}</p>
                    </Card>
                  ))}
                </div>

                {/* Reports */}
                <div>
                  <h3 className="mb-2 font-semibold text-sm text-muted-foreground uppercase tracking-wide">Reports</h3>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Reporter</TableHead>
                        <TableHead>Target</TableHead>
                        <TableHead>Reason</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {reports.map((r) => (
                        <TableRow key={r.id}>
                          <TableCell>{users.find((u) => u.id === r.reporterId)?.displayName || r.reporterId}</TableCell>
                          <TableCell>{r.targetType}:{r.targetId.slice(0, 6)}</TableCell>
                          <TableCell>{r.reason}</TableCell>
                          <TableCell>
                            <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-full ${
                              r.status === "resolved" ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-700"
                            }`}>{r.status}</span>
                          </TableCell>
                          <TableCell className="text-right">
                            <Button size="sm" variant="outline"
                              onClick={async () => {
                                const next = r.status === "open" ? "resolved" : "open";
                                await updateReportStatus(r.id, me.id, next);
                                toast.success(`Report marked ${next}`);
                                qc.invalidateQueries({ queryKey: ["admin.reports"] });
                              }}>
                              {r.status === "open" ? "Resolve" : "Reopen"}
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                {/* Audit Log */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Audit Log</h3>
                    <Button size="sm" variant="outline" className="gap-1"
                      onClick={() => {
                        const csv = exportAuditLog({
                          action: search.au_action || undefined,
                          from: toDayStart(search.au_from ?? "") ?? undefined,
                          to: toDayEnd(search.au_to ?? "") ?? undefined,
                        });
                        const blob = new Blob([csv], { type: "text/csv" });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url; a.download = "audit_log.csv"; a.click();
                        URL.revokeObjectURL(url);
                      }}>
                      <Download className="h-3.5 w-3.5" /> Export CSV
                    </Button>
                  </div>
                  <div className="mb-3 grid gap-2 rounded-lg border bg-card p-3 sm:grid-cols-2 lg:grid-cols-5">
                    <div className="lg:col-span-2">
                      <Label htmlFor="au_user" className="text-xs">User</Label>
                      <Input id="au_user" placeholder="Name or email…"
                        value={search.au_user ?? ""} onChange={(e) => setSearch({ au_user: e.target.value })} />
                    </div>
                    <div>
                      <Label htmlFor="au_action" className="text-xs">Action</Label>
                      <Select value={search.au_action || "__all"} onValueChange={(v) => setSearch({ au_action: v === "__all" ? "" : v })}>
                        <SelectTrigger id="au_action"><SelectValue placeholder="All actions" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__all">All actions</SelectItem>
                          {auditActions.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor="au_from" className="text-xs">From</Label>
                      <Input id="au_from" type="date" value={search.au_from ?? ""} onChange={(e) => setSearch({ au_from: e.target.value })} />
                    </div>
                    <div>
                      <Label htmlFor="au_to" className="text-xs">To</Label>
                      <Input id="au_to" type="date" value={search.au_to ?? ""} onChange={(e) => setSearch({ au_to: e.target.value })} />
                    </div>
                    {auActive && (
                      <div className="sm:col-span-2 lg:col-span-5 flex justify-between text-xs text-muted-foreground">
                        <span>{filteredAudits.length} of {audits.length} entries</span>
                        <Button size="sm" variant="ghost" onClick={auClear}>
                          <X className="mr-1 h-3.5 w-3.5" /> Clear filters
                        </Button>
                      </div>
                    )}
                  </div>
                  {filteredAudits.length === 0 ? (
                    <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">No results match your filters.</div>
                  ) : (
                    <Table>
                      <TableHeader><TableRow><TableHead>When</TableHead><TableHead>Admin</TableHead><TableHead>Action</TableHead><TableHead>Target</TableHead></TableRow></TableHeader>
                      <TableBody>
                        {filteredAudits.map((a) => (
                          <TableRow key={a.id}>
                            <TableCell>{timeAgo(a.createdAt)}</TableCell>
                            <TableCell>{users.find((u) => u.id === a.adminId)?.displayName || a.adminId}</TableCell>
                            <TableCell><code className="text-xs bg-muted px-1.5 py-0.5 rounded">{a.action}</code></TableCell>
                            <TableCell>{a.targetType}:{a.targetId.slice(0, 8)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </div>

                {/* Boost History */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Boost History</h3>
                  </div>
                  <div className="mb-3 grid gap-2 rounded-lg border bg-card p-3 sm:grid-cols-2 lg:grid-cols-5">
                    <div className="lg:col-span-2">
                      <Label htmlFor="bo_user" className="text-xs">Admin</Label>
                      <Input id="bo_user" placeholder="Name or email…"
                        value={search.bo_user ?? ""} onChange={(e) => setSearch({ bo_user: e.target.value })} />
                    </div>
                    <div>
                      <Label htmlFor="bo_kind" className="text-xs">Type</Label>
                      <Select value={search.bo_kind || "__all"} onValueChange={(v) => setSearch({ bo_kind: v === "__all" ? "" : v })}>
                        <SelectTrigger id="bo_kind"><SelectValue placeholder="All types" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__all">All types</SelectItem>
                          <SelectItem value="likes">Likes</SelectItem>
                          <SelectItem value="views">Views</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor="bo_from" className="text-xs">From</Label>
                      <Input id="bo_from" type="date" value={search.bo_from ?? ""} onChange={(e) => setSearch({ bo_from: e.target.value })} />
                    </div>
                    <div>
                      <Label htmlFor="bo_to" className="text-xs">To</Label>
                      <Input id="bo_to" type="date" value={search.bo_to ?? ""} onChange={(e) => setSearch({ bo_to: e.target.value })} />
                    </div>
                    {boActive && (
                      <div className="sm:col-span-2 lg:col-span-5 flex justify-between text-xs text-muted-foreground">
                        <span>{filteredBoosts.length} of {boosts.length} boosts</span>
                        <Button size="sm" variant="ghost" onClick={boClear}>
                          <X className="mr-1 h-3.5 w-3.5" /> Clear filters
                        </Button>
                      </div>
                    )}
                  </div>
                  {filteredBoosts.length === 0 ? (
                    <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">No results.</div>
                  ) : (
                    <Table>
                      <TableHeader><TableRow><TableHead>When</TableHead><TableHead>Admin</TableHead><TableHead>Post</TableHead><TableHead>Kind</TableHead><TableHead>Amount</TableHead></TableRow></TableHeader>
                      <TableBody>
                        {filteredBoosts.map((b) => (
                          <TableRow key={b.id}>
                            <TableCell>{timeAgo(b.createdAt)}</TableCell>
                            <TableCell>{users.find((u) => u.id === b.adminId)?.displayName || b.adminId}</TableCell>
                            <TableCell>{b.postId.slice(0, 8)}</TableCell>
                            <TableCell>{b.kind}</TableCell>
                            <TableCell>+{b.amount}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </div>

        <BoostDialog postId={boostFor} open={!!boostFor} onOpenChange={(o) => !o && setBoostFor(null)} />

        {/* Edit User Dialog */}
        {editUserOpen && (
          <EditUserDialog
            userId={editUserOpen}
            users={users}
            adminId={me.id}
            onClose={() => setEditUserOpen(null)}
            onSaved={() => { qc.invalidateQueries({ queryKey: ["users"] }); setEditUserOpen(null); }}
          />
        )}

        {/* Edit Group Dialog */}
        {editGroupOpen && (
          <EditGroupDialog
            groupId={editGroupOpen}
            users={users}
            adminId={me.id}
            onClose={() => setEditGroupOpen(null)}
            onSaved={() => { qc.invalidateQueries(); setEditGroupOpen(null); }}
          />
        )}

        {/* Edit Channel Dialog */}
        {editChannelOpen && (
          <EditChannelDialog
            channelId={editChannelOpen}
            users={users}
            adminId={me.id}
            onClose={() => setEditChannelOpen(null)}
            onSaved={() => { qc.invalidateQueries(); setEditChannelOpen(null); }}
          />
        )}
      </div>
    </FeatureBoundary>
  );
}

// ─── Edit User Dialog ────────────────────────────────────────────────────
function EditUserDialog({ userId, users, adminId, onClose, onSaved }: {
  userId: string; users: any[]; adminId: string; onClose: () => void; onSaved: () => void;
}) {
  const user = users.find((u) => u.id === userId);
  const [displayName, setDisplayName] = useState(user?.displayName ?? "");
  const [bio, setBio] = useState(user?.bio ?? "");
  const [role, setRole] = useState(user?.role ?? "user");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await editUserProfile(userId, adminId, { displayName, bio, role });
      toast.success("User profile updated");
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Edit User — {user?.displayName}</DialogTitle></DialogHeader>
        <div className="space-y-3 pt-2">
          <div><Label className="text-sm">Display Name</Label>
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </div>
          <div><Label className="text-sm">Bio</Label>
            <Textarea value={bio} onChange={(e) => setBio(e.target.value)} rows={2} />
          </div>
          <div><Label className="text-sm">Role</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="user">User</SelectItem>
                <SelectItem value="member">Member</SelectItem>
                <SelectItem value="owner">Owner</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Save Changes"}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Edit Group Dialog ───────────────────────────────────────────────────
function EditGroupDialog({ groupId, users, adminId, onClose, onSaved }: {
  groupId: string; users: any[]; adminId: string; onClose: () => void; onSaved: () => void;
}) {
  const group = getState().chats.find((c) => c.id === groupId);
  const [name, setName] = useState(group?.name ?? "");
  const [newOwner, setNewOwner] = useState(group?.ownerId ?? "");
  const [kickUser, setKickUser] = useState("");
  const [saving, setSaving] = useState(false);
  const qc = useQueryClient();

  const handleSave = async () => {
    setSaving(true);
    try {
      await editGroup(groupId, adminId, { name });
      if (newOwner && newOwner !== group?.ownerId) {
        await transferGroupOwnership(groupId, newOwner, adminId);
      }
      toast.success("Group updated");
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  const handleKick = async () => {
    if (!kickUser) return;
    await removeGroupMember(groupId, kickUser, adminId);
    toast.success("Member removed");
    qc.invalidateQueries();
  };

  const members = (group?.memberIds ?? []).map((id) => users.find((u) => u.id === id)).filter(Boolean);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Edit Group — {group?.name}</DialogTitle></DialogHeader>
        <div className="space-y-3 pt-2">
          <div><Label className="text-sm">Group Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Label className="text-sm">Transfer Ownership</Label>
            <Select value={newOwner} onValueChange={setNewOwner}>
              <SelectTrigger><SelectValue placeholder="Select new owner" /></SelectTrigger>
              <SelectContent>
                {members.map((u: any) => <SelectItem key={u.id} value={u.id}>{u.displayName}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-sm">Remove Member</Label>
            <div className="flex gap-2">
              <Select value={kickUser} onValueChange={setKickUser}>
                <SelectTrigger><SelectValue placeholder="Select member to remove" /></SelectTrigger>
                <SelectContent>
                  {members.map((u: any) => <SelectItem key={u.id} value={u.id}>{u.displayName}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button variant="destructive" size="sm" onClick={handleKick} disabled={!kickUser}>
                <UserMinus className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Save Changes"}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Edit Channel Dialog ─────────────────────────────────────────────────
function EditChannelDialog({ channelId, users, adminId, onClose, onSaved }: {
  channelId: string; users: any[]; adminId: string; onClose: () => void; onSaved: () => void;
}) {
  const channel = getState().channels.find((c) => c.id === channelId);
  const [name, setName] = useState(channel?.name ?? "");
  const [description, setDescription] = useState(channel?.description ?? "");
  const [ownerId, setOwnerId] = useState(channel?.ownerId ?? "");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await editChannel(channelId, adminId, { name, description, ownerId });
      toast.success("Channel updated");
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Edit Channel — {channel?.name}</DialogTitle></DialogHeader>
        <div className="space-y-3 pt-2">
          <div><Label className="text-sm">Channel Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div><Label className="text-sm">Description</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </div>
          <div>
            <Label className="text-sm">Transfer Ownership</Label>
            <Select value={ownerId} onValueChange={setOwnerId}>
              <SelectTrigger><SelectValue placeholder="Select new owner" /></SelectTrigger>
              <SelectContent>
                {users.map((u) => <SelectItem key={u.id} value={u.id}>{u.displayName}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Save Changes"}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
