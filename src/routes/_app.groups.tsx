import { createFileRoute, Link, Outlet, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Users, Plus } from "lucide-react";
import { UserAvatar } from "@/components/UserAvatar";
import { EmptyState } from "@/components/EmptyState";
import { FeatureBoundary } from "@/components/FeatureBoundary";
import { listChats, createGroup, subscribeToChats } from "@/api/chatsApi";
import { listUsers } from "@/api/usersApi";
import { useAuth } from "@/hooks/useAuth";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/_app/groups")({
  component: GroupsPage,
  head: () => ({ meta: [{ title: "Groups — Meshly" }] }),
});

function GroupsPage() {
  const me = useAuth();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<string[]>([]);

  const { data: chats = [] } = useQuery({
    queryKey: ["chats", me?.id ?? ""],
    queryFn: () => listChats(me!.id),
    enabled: !!me,
  });
  const { data: users = [] } = useQuery({ queryKey: ["users"], queryFn: listUsers, enabled: !!me });

  useEffect(() => {
    if (!me) return;
    const u = subscribeToChats(() => qc.invalidateQueries({ queryKey: ["chats", me.id] }));
    return u;
  }, [me, qc]);

  if (!me) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  const groups = chats.filter((c) => c.type === "group");

  const create = async () => {
    if (!name.trim()) return;
    const g = await createGroup({ name: name.trim(), memberIds: selected, ownerId: me.id });
    setOpen(false); setName(""); setSelected([]);
    nav({ to: "/groups/$groupId", params: { groupId: g.id } });
  };

  return (
    <FeatureBoundary name="groups">
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-16 items-center justify-between border-b bg-card px-4">
          <h1 className="text-xl font-semibold">Groups</h1>
          <Button size="icon" variant="ghost" onClick={() => setOpen(true)}>
            <Plus className="h-5 w-5" />
          </Button>
        </header>
        <div className="flex-1 overflow-y-auto">
          {groups.length === 0 ? (
            <EmptyState
              icon={Users} title="No groups yet"
              description="Create a group to chat with multiple people."
              action={<Button onClick={() => setOpen(true)}>Create group</Button>}
            />
          ) : (
            <ul>
              {groups.map((g) => (
                <li key={g.id}>
                  <Link
                    to="/groups/$groupId" params={{ groupId: g.id }}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-muted"
                  >
                    <UserAvatar name={g.name || "Group"} src={g.avatar} size={48} />
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold">{g.name}</p>
                      <p className="truncate text-xs text-muted-foreground">{g.memberIds.length} members</p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <Outlet />

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>Create group</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Group name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Weekend Crew" />
              </div>
              <div>
                <Label>Add members</Label>
                <div className="mt-2 max-h-64 space-y-1 overflow-y-auto rounded-lg border p-2">
                  {users.filter((u) => u.id !== me.id).map((u) => (
                    <label key={u.id} className="flex items-center gap-3 rounded-md p-2 hover:bg-muted cursor-pointer">
                      <Checkbox
                        checked={selected.includes(u.id)}
                        onCheckedChange={(v) => setSelected((s) => v ? [...s, u.id] : s.filter((x) => x !== u.id))}
                      />
                      <UserAvatar name={u.displayName} src={u.avatar} size={36} />
                      <span className="text-sm">{u.displayName}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={create} disabled={!name.trim()}>Create</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </FeatureBoundary>
  );
}
