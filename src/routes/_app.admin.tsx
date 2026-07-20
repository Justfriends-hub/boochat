import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
  Users, MessageCircle, Radio, Image as ImageIcon, Heart, Eye, TrendingUp, ShieldAlert,
} from "lucide-react";

export const Route = createFileRoute("/_app/admin")({
  component: AdminPage,
  head: () => ({ meta: [{ title: "Admin — Meshly" }] }),
});

function AdminPage() {
  const me = useAuth();
  const nav = useNavigate();
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
                  <s.icon className="h-4 w-4" /> {s.label}
                </div>
                <p className="mt-1 text-2xl font-semibold">{s.value}</p>
              </Card>
            ))}
          </div>

          <Tabs defaultValue="users" className="w-full">
            <TabsList className="flex-wrap">
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
              <Table>
                <TableHeader><TableRow><TableHead>When</TableHead><TableHead>Admin</TableHead><TableHead>Action</TableHead><TableHead>Target</TableHead></TableRow></TableHeader>
                <TableBody>
                  {audits.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell>{timeAgo(a.createdAt)}</TableCell>
                      <TableCell>{users.find((u) => u.id === a.adminId)?.displayName || a.adminId}</TableCell>
                      <TableCell>{a.action}</TableCell>
                      <TableCell>{a.targetType}:{a.targetId.slice(0, 6)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TabsContent>

            <TabsContent value="boosts">
              <Table>
                <TableHeader><TableRow><TableHead>When</TableHead><TableHead>Admin</TableHead><TableHead>Post</TableHead><TableHead>Kind</TableHead><TableHead>Amount</TableHead></TableRow></TableHeader>
                <TableBody>
                  {boosts.map((b) => (
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
            </TabsContent>
          </Tabs>
        </div>

        <BoostDialog postId={boostFor} open={!!boostFor} onOpenChange={(o) => !o && setBoostFor(null)} />
      </div>
    </FeatureBoundary>
  );
}
