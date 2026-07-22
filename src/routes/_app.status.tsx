import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Circle as CircleIcon } from "lucide-react";
import { UserAvatar } from "@/components/UserAvatar";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/EmptyState";
import { FeatureBoundary } from "@/components/FeatureBoundary";
import { StoryViewer } from "@/components/StoryViewer";
import {
  listActiveStatuses, createStatus, subscribeToStatuses, isExpired,
} from "@/api/statusApi";
import { listUsers } from "@/api/usersApi";
import { getState } from "@/lib/mockStore";
import { useAuth } from "@/hooks/useAuth";
import { timeAgo } from "@/lib/format";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/status")({
  component: StatusPage,
  head: () => ({ meta: [{ title: "Status — Meshly" }] }),
});

function StatusPage() {
  const me = useAuth();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [viewerIdx, setViewerIdx] = useState<number | null>(null);
  const [viewerList, setViewerList] = useState<any[]>([]);

  const { data: statuses = [] } = useQuery({
    queryKey: ["statuses"],
    queryFn: listActiveStatuses,
    refetchInterval: 60_000, // recompute expiry
    enabled: !!me,
  });
  const { data: users = [] } = useQuery({ queryKey: ["users"], queryFn: listUsers, enabled: !!me });

  useEffect(() => {
    if (!me) return;
    const unsub = subscribeToStatuses(() => qc.invalidateQueries({ queryKey: ["statuses"] }));
    return unsub;
  }, [me, qc]);

  if (!me) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  const my = useMemo(() => statuses.filter((s) => s.userId === me.id), [statuses, me.id]);
  const others = useMemo(() => statuses.filter((s) => s.userId !== me.id), [statuses, me.id]);
  const recent = others.filter((s) => !s.viewedBy.includes(me.id));
  const viewed = others.filter((s) => s.viewedBy.includes(me.id));

  const upload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f || !me) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        await createStatus({
          userId: me.id,
          kind: f.type.startsWith("video/") ? "video" : "image",
          media: String(reader.result),
        });
        qc.invalidateQueries({ queryKey: ["statuses"] });
        toast.success("Status update added!");
      } catch (err: any) {
        toast.error(err.message || "Failed to upload status");
      }
    };
    reader.readAsDataURL(f);
    e.target.value = "";
  };

  const openViewer = (list: any[], idx: number) => {
    setViewerList(list);
    setViewerIdx(idx);
  };

  return (
    <FeatureBoundary name="status">
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-16 items-center justify-between border-b bg-card px-4">
          <h1 className="text-xl font-semibold">Status</h1>
        </header>
        <div className="flex-1 overflow-y-auto">
          <input ref={fileRef} type="file" accept="image/*,video/*" hidden onChange={upload} />
          <section className="border-b p-3">
            <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">My Status</p>
            <button
              onClick={() => my.length ? openViewer(my, 0) : fileRef.current?.click()}
              className="flex w-full items-center gap-3 rounded-xl p-2 hover:bg-muted"
            >
              <div className="relative">
                <UserAvatar name={me.displayName} src={me.avatar} size={52} />
                {my.length === 0 && (
                  <span className="absolute -bottom-1 -right-1 grid h-6 w-6 place-items-center rounded-full bg-primary text-primary-foreground border-2 border-background">
                    <Plus className="h-3.5 w-3.5" />
                  </span>
                )}
              </div>
              <div className="text-left">
                <p className="font-semibold">My status</p>
                <p className="text-xs text-muted-foreground">
                  {my.length ? `${my.length} update${my.length > 1 ? "s" : ""} • ${timeAgo(my[0].createdAt)}` : "Tap to add status update"}
                </p>
              </div>
              <Button size="sm" variant="ghost" className="ml-auto" onClick={(e) => { e.stopPropagation(); fileRef.current?.click(); }}>
                Upload
              </Button>
            </button>
          </section>

          {recent.length > 0 && (
            <section className="border-b p-3">
              <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Recent Updates</p>
              <StatusList items={recent} users={users} onOpen={(i) => openViewer(recent, i)} />
            </section>
          )}
          {viewed.length > 0 && (
            <section className="p-3">
              <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Viewed Updates</p>
              <StatusList items={viewed} users={users} onOpen={(i) => openViewer(viewed, i)} />
            </section>
          )}
          {others.length === 0 && (
            <EmptyState icon={CircleIcon} title="No status updates" description="When friends share, you'll see them here." />
          )}
        </div>

        {viewerIdx !== null && (
          <StoryViewer
            statuses={viewerList}
            users={users}
            initialIndex={viewerIdx}
            viewerId={me.id}
            onClose={() => setViewerIdx(null)}
          />
        )}
      </div>
    </FeatureBoundary>
  );
}

function StatusList({ items, users, onOpen }: { items: any[]; users: any[]; onOpen: (i: number) => void }) {
  return (
    <ul className="space-y-1">
      {items.map((s, i) => {
        const u = users.find((x: any) => x.id === s.userId);
        return (
          <li key={s.id}>
            <button
              onClick={() => onOpen(i)}
              className="flex w-full items-center gap-3 rounded-xl p-2 text-left hover:bg-muted"
            >
              <div className="rounded-full ring-2 ring-primary p-0.5">
                <UserAvatar name={u?.displayName || ""} src={u?.avatar} size={48} />
              </div>
              <div>
                <p className="font-medium">{u?.displayName}</p>
                <p className="text-xs text-muted-foreground">{timeAgo(s.createdAt)}</p>
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
