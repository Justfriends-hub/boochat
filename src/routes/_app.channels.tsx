import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Radio, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { UserAvatar } from "@/components/UserAvatar";
import { EmptyState } from "@/components/EmptyState";
import { FeatureBoundary } from "@/components/FeatureBoundary";
import { listChannels, createChannel, subscribeToChannels } from "@/api/channelsApi";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/_app/channels")({
  component: ChannelsPage,
  head: () => ({ meta: [{ title: "Channels — Meshly" }] }),
});

function ChannelsPage() {
  const me = useAuth();
  const nav = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location?.pathname });
  const qc = useQueryClient();

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  const { data: channels = [] } = useQuery({ queryKey: ["channels"], queryFn: listChannels });
  useEffect(() => subscribeToChannels(() => qc.invalidateQueries({ queryKey: ["channels"] })), [qc]);

  const isChannelDetailRoute = typeof pathname === "string" && pathname !== "/channels" && pathname.startsWith("/channels/");

  if (isChannelDetailRoute) {
    return (
      <FeatureBoundary name="channels">
        <div className="flex flex-1 flex-col h-full min-h-0 overflow-hidden">
          <Outlet />
        </div>
      </FeatureBoundary>
    );
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !me) return;
    setIsCreating(true);
    try {
      const ch = await createChannel({
        name: name.trim(),
        description: description.trim(),
        ownerId: me.id,
        onlyAdminsPost: true,
      });
      toast.success("Channel created successfully!");
      setCreateOpen(false);
      setName("");
      setDescription("");
      nav({ to: "/channels/$channelId", params: { channelId: ch.id } });
    } catch (err: any) {
      toast.error(err.message || "Failed to create channel");
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <FeatureBoundary name="channels">
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-16 items-center justify-between border-b bg-card px-4">
          <h1 className="text-xl font-semibold">Channels</h1>
          <Button size="sm" onClick={() => setCreateOpen(true)} className="gap-1 rounded-full">
            <Plus className="h-4 w-4" /> Create Channel
          </Button>
        </header>
        <div className="flex-1 overflow-y-auto">
          {channels.length === 0 ? (
            <EmptyState
              icon={Radio}
              title="No channels yet"
              description="Be the first to create a public channel to share updates with your followers."
              action={
                <Button onClick={() => setCreateOpen(true)} className="gap-1">
                  <Plus className="h-4 w-4" /> Create Channel
                </Button>
              }
            />
          ) : (
            <ul className="p-3 space-y-2">
              {channels.map((c) => (
                <li key={c.id}>
                  <Link
                    to="/channels/$channelId" params={{ channelId: c.id }}
                    className="flex items-center gap-3 rounded-xl border bg-card p-3 hover:bg-muted transition-colors"
                  >
                    <UserAvatar name={c.name} src={c.avatar} size={48} />
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold">{c.name}</p>
                      <p className="truncate text-sm text-muted-foreground">{c.description || "No description"}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{c.memberIds.length} subscriber{c.memberIds.length === 1 ? "" : "s"}</p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create a Channel</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleCreate} className="space-y-4 pt-2">
              <div className="space-y-1">
                <label className="text-sm font-medium">Channel Name</label>
                <Input
                  required
                  placeholder="e.g. Tech News, Daily Announcements"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Description</label>
                <Textarea
                  placeholder="What is this channel about?"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="ghost" onClick={() => setCreateOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={isCreating || !name.trim()}>
                  {isCreating ? "Creating..." : "Create Channel"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
        <Outlet />
      </div>
    </FeatureBoundary>
  );
}
