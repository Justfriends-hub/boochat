import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import {
  Tabs, TabsList, TabsTrigger, TabsContent,
} from "@/components/ui/tabs";
import {
  Table, TableHeader, TableRow, TableHead, TableBody, TableCell,
} from "@/components/ui/table";
import { UserAvatar } from "@/components/UserAvatar";
import { BoostDialog } from "@/components/BoostDialog";
import { FeatureBoundary } from "@/components/FeatureBoundary";
import {
  overviewStats, toggleBan, deletePostAsAdmin,
  listBoosts, listAuditLogs, listReports, seedAdminExtras,
} from "@/api/adminApi";
import { listUsers } from "@/api/usersApi";
import { listPosts, likeCount, viewCount } from "@/api/channelsApi";
import { listActiveStatuses } from "@/api/statusApi";
import { getState } from "@/lib/mockStore";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { timeAgo } from "@/lib/format";
import {
  Users, MessageCircle, Radio, Image as ImageIcon, Heart, Eye, TrendingUp, ShieldAlert, X,
} from "lucide-react";

const searchSchema = z.object({
  tab: fallback(z.string(), "users").default("users"),
  au_user: fallback(z.string(), "").default(""),
  au_action: fallback(z.string(), "").default(""),
  au_from: fallback(z.string(), "").default(""),
  au_to: fallback(z.string(), "").default(""),
  bo_user: fallback(z.string(), "").default(""),
  bo_kind: fallback(z.string(), "").default(""),
  bo_from: fallback(z.string(), "").default(""),
  bo_to: fallback(z.string(), "").default(""),
});

export const Route = createFileRoute("/_app/admin")({
  validateSearch: zodValidator(searchSchema),
  component: AdminPage,
  head: () => ({ meta: [{ title: "Admin — Meshly" }] }),
});

function toDayStart(s: string) { return s ? new Date(s + "T00:00:00").getTime() : null; }
function toDayEnd(s: string) { return s ? new Date(s + "T23:59:59.999").getTime() : null; }

function AdminPage() {
  const me = useAuth();
  const nav = useNavigate({ from: "/admin" });
  const search = Route.useSearch();
  const qc = useQueryClient();
  const [boostFor, setBoostFor] = useState<string | null>(null);

  useEffect(() => {
    if (me && me.role !== "admin") nav({ to: "/chats" });
  }, [me, nav]);
  useEffect(() => { seedAdminExtras(); }, []);

  const { data: stats } = useQuery({ queryKey: ["admin.stats"], queryFn: overviewStats });
  const { data: users = [] } = useQuery({ queryKey: ["users"], queryFn: listUsers });
  const { data: posts = [] } = useQuery({ queryKey: ["admin.posts"], queryFn: () => listPosts() });
  const { data: statuses = [] } = useQuery({ queryKey: ["admin.statuses"], queryFn: listActiveStatuses });
  const { data: boosts = [] } = useQuery({ queryKey: ["admin.boosts"], queryFn: listBoosts });
  const { data: audits = [] } = useQuery({ queryKey: ["admin.audits"], queryFn: listAuditLogs });
  const { data: reports = [] } = useQuery({ queryKey: ["admin.reports"], queryFn: listReports });

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
    const q = search.au_user.toLowerCase().trim();
    const from = toDayStart(search.au_from);
    const to = toDayEnd(search.au_to);
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
    const q = search.bo_user.toLowerCase().trim();
    const from = toDayStart(search.bo_from);
    const to = toDayEnd(search.bo_to);
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

  if (!me || me.role !== "admin") return null;

  const statCards = [
    { label: "Users", value: stats?.users || 0, icon: Users },
    { label: "Chats", value: stats?.chats || 0, icon: MessageCircle },
    { label: "Groups", value: stats?.groups || 0, icon: Users },
    { label: "Channels", value: stats?.channels || 0, icon: Radio },
    { label: "Posts", value: stats?.posts || 0, icon: MessageCircle },
    { label: "Statuses", value: stats?.statuses || 0, icon: ImageIcon },
    { label: "Likes", value: stats?.likes || 0, icon: Heart },
    { label: "Views", value: stats?.views || 0, icon: Eye },
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
        <header className="flex h-16 items-center border-b bg-card px-4">
          <h1 className="text-xl font-semibold">Admin Panel</h1>
        </header>
        <div className="flex-1 overflow-y-auto p-4">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
            {statCards.map((s) => (
              <Card key={s.label} className="p-4">
                <div className="flex items-center gap-2 text-muted-foreground text-xs">
                  <s.icon className="h-4 w-4" aria-hidden="true" /> {s.label}
                </div>
                <p className="mt-1 text-2xl font-semibold">{s.value}</p>
              </Card>
            ))}
          </div>

          <Tabs
            value={search.tab}
            onValueChange={(v) => setSearch({ tab: v })}
            className="w-full"
          >
            <TabsList className="flex-wrap h-auto">
              <TabsTrigger value="users">Users</TabsTrigger>
              <TabsTrigger value="chats">Chats & Groups</TabsTrigger>
              <TabsTrigger value="channels">Channels</TabsTrigger>
              <TabsTrigger value="posts">Posts</TabsTrigger>
              <TabsTrigger value="statuses">Statuses</TabsTrigger>
              <TabsTrigger value="reports">Reports</TabsTrigger>
              <TabsTrigger value="audits">Audit Log</TabsTrigger>
              <TabsTrigger value="boosts">Boosts</TabsTrigger>
            </TabsList>

            <TabsContent value="users">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>User</TableHead><TableHead>Email</TableHead><TableHead>Role</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {users.map((u) => (
                    <TableRow key={u.id}>
                      <TableCell className="flex items-center gap-2"><UserAvatar name={u.displayName} src={u.avatar} size={28} />{u.displayName}</TableCell>
                      <TableCell>{u.email}</TableCell>
                      <TableCell>{u.role}</TableCell>
                      <TableCell>{u.banned ? <span className="text-destructive">Banned</span> : "Active"}</TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant={u.banned ? "outline" : "destructive"} onClick={async () => {
                          await toggleBan(u.id, me.id);
                          toast.success(u.banned ? "User unbanned" : "User banned");
                          qc.invalidateQueries();
                        }}>
                          {u.banned ? "Unban" : "Ban"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TabsContent>

            <TabsContent value="chats">
              <Table>
                <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Type</TableHead><TableHead>Members</TableHead></TableRow></TableHeader>
                <TableBody>
                  {getState().chats.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell>{c.name || c.memberIds.map((id) => users.find((u) => u.id === id)?.displayName).join(", ")}</TableCell>
                      <TableCell>{c.type}</TableCell>
                      <TableCell>{c.memberIds.length}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TabsContent>

            <TabsContent value="channels">
              <Table>
                <TableHeader><TableRow><TableHead>Channel</TableHead><TableHead>Subscribers</TableHead><TableHead>Posts</TableHead></TableRow></TableHeader>
                <TableBody>
                  {getState().channels.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell>{c.name}</TableCell>
                      <TableCell>{c.memberIds.length}</TableCell>
                      <TableCell>{posts.filter((p) => p.channelId === c.id).length}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TabsContent>

            <TabsContent value="posts">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Body</TableHead><TableHead>Likes</TableHead><TableHead>Views</TableHead><TableHead className="text-right">Actions</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {posts.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="max-w-md truncate">{p.body}</TableCell>
                      <TableCell>{likeCount(p)}</TableCell>
                      <TableCell>{viewCount(p)}</TableCell>
                      <TableCell className="text-right space-x-2">
                        <Button size="sm" variant="outline" onClick={() => setBoostFor(p.id)}>Boost</Button>
                        <Button size="sm" variant="destructive" onClick={async () => {
                          await deletePostAsAdmin(p.id, me.id);
                          toast.success("Post deleted");
                          qc.invalidateQueries();
                        }}>Delete</Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TabsContent>

            <TabsContent value="statuses">
              <Table>
                <TableHeader><TableRow><TableHead>User</TableHead><TableHead>Kind</TableHead><TableHead>Created</TableHead></TableRow></TableHeader>
                <TableBody>
                  {statuses.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell>{users.find((u) => u.id === s.userId)?.displayName}</TableCell>
                      <TableCell>{s.kind}</TableCell>
                      <TableCell>{timeAgo(s.createdAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TabsContent>

            <TabsContent value="reports">
              <Table>
                <TableHeader><TableRow><TableHead>Reporter</TableHead><TableHead>Target</TableHead><TableHead>Reason</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                <TableBody>
                  {reports.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>{users.find((u) => u.id === r.reporterId)?.displayName || r.reporterId}</TableCell>
                      <TableCell>{r.targetType}:{r.targetId.slice(0, 6)}</TableCell>
                      <TableCell>{r.reason}</TableCell>
                      <TableCell>{r.status}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TabsContent>

            <TabsContent value="audits">
              <div className="mb-3 grid gap-2 rounded-lg border bg-card p-3 sm:grid-cols-2 lg:grid-cols-5">
                <div className="lg:col-span-2">
                  <Label htmlFor="au_user" className="text-xs">User</Label>
                  <Input
                    id="au_user"
                    placeholder="Name or email…"
                    value={search.au_user}
                    onChange={(e) => setSearch({ au_user: e.target.value })}
                  />
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
                  <Input id="au_from" type="date" value={search.au_from} onChange={(e) => setSearch({ au_from: e.target.value })} />
                </div>
                <div>
                  <Label htmlFor="au_to" className="text-xs">To</Label>
                  <Input id="au_to" type="date" value={search.au_to} onChange={(e) => setSearch({ au_to: e.target.value })} />
                </div>
                {auActive && (
                  <div className="sm:col-span-2 lg:col-span-5 flex justify-between text-xs text-muted-foreground">
                    <span>{filteredAudits.length} of {audits.length} entries</span>
                    <Button size="sm" variant="ghost" onClick={auClear}>
                      <X className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Clear filters
                    </Button>
                  </div>
                )}
              </div>
              {filteredAudits.length === 0 ? (
                <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                  No results match your filters.
                </div>
              ) : (
                <Table>
                  <TableHeader><TableRow><TableHead>When</TableHead><TableHead>Admin</TableHead><TableHead>Action</TableHead><TableHead>Target</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {filteredAudits.map((a) => (
                      <TableRow key={a.id}>
                        <TableCell>{timeAgo(a.createdAt)}</TableCell>
                        <TableCell>{users.find((u) => u.id === a.adminId)?.displayName || a.adminId}</TableCell>
                        <TableCell>{a.action}</TableCell>
                        <TableCell>{a.targetType}:{a.targetId.slice(0, 6)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </TabsContent>

            <TabsContent value="boosts">
              <div className="mb-3 grid gap-2 rounded-lg border bg-card p-3 sm:grid-cols-2 lg:grid-cols-5">
                <div className="lg:col-span-2">
                  <Label htmlFor="bo_user" className="text-xs">Admin</Label>
                  <Input
                    id="bo_user"
                    placeholder="Name or email…"
                    value={search.bo_user}
                    onChange={(e) => setSearch({ bo_user: e.target.value })}
                  />
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
                  <Input id="bo_from" type="date" value={search.bo_from} onChange={(e) => setSearch({ bo_from: e.target.value })} />
                </div>
                <div>
                  <Label htmlFor="bo_to" className="text-xs">To</Label>
                  <Input id="bo_to" type="date" value={search.bo_to} onChange={(e) => setSearch({ bo_to: e.target.value })} />
                </div>
                {boActive && (
                  <div className="sm:col-span-2 lg:col-span-5 flex justify-between text-xs text-muted-foreground">
                    <span>{filteredBoosts.length} of {boosts.length} boosts</span>
                    <Button size="sm" variant="ghost" onClick={boClear}>
                      <X className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Clear filters
                    </Button>
                  </div>
                )}
              </div>
              {filteredBoosts.length === 0 ? (
                <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                  No results match your filters.
                </div>
              ) : (
                <Table>
                  <TableHeader><TableRow><TableHead>When</TableHead><TableHead>Admin</TableHead><TableHead>Post</TableHead><TableHead>Kind</TableHead><TableHead>Amount</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {filteredBoosts.map((b) => (
                      <TableRow key={b.id}>
                        <TableCell>{timeAgo(b.createdAt)}</TableCell>
                        <TableCell>{users.find((u) => u.id === b.adminId)?.displayName || b.adminId}</TableCell>
                        <TableCell>{b.postId.slice(0, 6)}</TableCell>
                        <TableCell>{b.kind}</TableCell>
                        <TableCell>+{b.amount}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </TabsContent>
          </Tabs>
        </div>

        <BoostDialog postId={boostFor} open={!!boostFor} onOpenChange={(o) => !o && setBoostFor(null)} />
      </div>
    </FeatureBoundary>
  );
}
