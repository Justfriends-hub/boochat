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
import { subscribe } from "@/lib/eventBus";

export const Route = createFileRoute("/_app/status")({
  component: StatusPage,
  head: () => ({ meta: [{ title: "Status — boochat" }] }),
});

function StatusPage() {
  const me = useAuth();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [viewerIdx, setViewerIdx] = useState<number | null>(null);
  const [viewerList, setViewerList] = useState<any[]>([]);

  const { data: statuses = [] } = useQuery({
    queryKey: ["statuses", me?.id],
    queryFn: () => listActiveStatuses(me?.id),
    refetchInterval: 60_000, // recompute expiry
    enabled: !!me,
  });
  const { data: users = [] } = useQuery({ queryKey: ["users"], queryFn: listUsers, enabled: !!me });

  useEffect(() => {
    if (!me) return;
    const unsub = subscribeToStatuses(() => qc.invalidateQueries({ queryKey: ["statuses"] }));
    const unsubSeed = subscribe("store:seeded", () => qc.invalidateQueries({ queryKey: ["statuses"] }));
    const unsubStatusChanged = subscribe("status:changed", () => qc.invalidateQueries({ queryKey: ["statuses"] }));
    return () => {
      unsub();
      unsubSeed();
      unsubStatusChanged();
    };
  }, [me, qc]);

  if (!me) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  const my = useMemo(
    () => statuses
      .filter((s) => s.userId === me.id)
      .sort((a, b) => b.createdAt - a.createdAt),
    [statuses, me.id],
  );

  const othersByUser = useMemo(() => {
    const groups = new Map<string, { statuses: any[]; latest: any; unreadCount: number }>();
    statuses.forEach((s) => {
      if (s.userId === me.id) return;
      const existing = groups.get(s.userId);
      const isUnread = !s.viewedBy.includes(me.id);
      if (!existing) {
        groups.set(s.userId, { statuses: [s], latest: s, unreadCount: isUnread ? 1 : 0 });
      } else {
        existing.statuses.push(s);
        if (s.createdAt > existing.latest.createdAt) existing.latest = s;
        if (isUnread) existing.unreadCount += 1;
      }
    });
    return Array.from(groups.entries())
      .map(([userId, group]) => {
        const sorted = group.statuses.sort((a, b) => b.createdAt - a.createdAt);
        return {
          userId,
          statuses: sorted,
          latest: sorted[0],
          unreadCount: sorted.filter((st) => !st.viewedBy.includes(me.id)).length,
        };
      })
      .sort((a, b) => b.latest.createdAt - a.latest.createdAt);
  }, [statuses, me.id]);

  const recent = othersByUser.filter((group) => group.unreadCount > 0);
  const viewed = othersByUser.filter((group) => group.unreadCount === 0);

  const upload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f || !me) return;

    try {
      await createStatus({
        userId: me.id,
        kind: f.type.startsWith("video/") ? "video" : "image",
        media: f,
      });
      qc.invalidateQueries({ queryKey: ["statuses"] });
      toast.success("Status update added!");
    } catch (err: any) {
      toast.error(err.message || "Failed to upload status");
    } finally {
      e.target.value = "";
    }
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
                {my.length > 0 && my[0].media ? (
                  <div className="h-16 w-16 overflow-hidden rounded-full border-2 border-primary bg-primary/5">
                    <img
                      src={my[0].media}
                      alt="status preview"
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-cover"
                    />
                  </div>
                ) : (
                  <UserAvatar name={me.displayName} src={me.avatar} size={52} />
                )}
                {my.length > 0 && my[0].media && (
                  <span className="pointer-events-none absolute inset-0 rounded-full ring-2 ring-primary" />
                )}
                {/* keep the add (+) affordance always visible so user can add another status */}
                  <button
                    onClick={(e) => { e.stopPropagation(); fileRef.current?.click(); }}
                    aria-label="Add status"
                    className="absolute -bottom-1 -right-1 grid h-6 w-6 place-items-center rounded-full bg-primary text-primary-foreground border-2 border-background"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
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
              <StatusList groups={recent} users={users} onOpen={(statuses) => openViewer(statuses, 0)} />
            </section>
          )}
          {viewed.length > 0 && (
            <section className="p-3">
              <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Viewed Updates</p>
              <StatusList groups={viewed} users={users} onOpen={(statuses) => openViewer(statuses, 0)} />
            </section>
          )}
          {othersByUser.length === 0 && (
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

function StatusList({ groups, users, onOpen }: { groups: Array<{ userId: string; statuses: any[]; latest: any; unreadCount: number }>; users: any[]; onOpen: (statuses: any[]) => void }) {
  return (
    <ul className="space-y-1">
      {groups.map((group) => {
        const u = users.find((x: any) => x.id === group.userId);
        const statusCount = group.statuses.length;
        return (
          <li key={group.userId}>
            <button
              onClick={() => onOpen(group.statuses)}
              className="flex w-full items-center gap-3 rounded-xl p-2 text-left hover:bg-muted"
            >
              <div className="relative">
                <div className="rounded-full ring-2 ring-primary p-0.5">
                  <UserAvatar name={u?.displayName || ""} src={u?.avatar} size={48} />
                </div>
                {group.latest?.media && (
                  <span className="absolute -inset-0.5 rounded-full overflow-hidden" style={{ width: 48, height: 48 }}>
                    <img src={group.latest.media} alt="status preview" loading="lazy" decoding="async" className="w-full h-full object-cover opacity-75" />
                    <span className="absolute inset-0 rounded-full ring-2 ring-primary pointer-events-none" />
                  </span>
                )}
                {group.unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 inline-flex items-center justify-center h-5 min-w-[1.25rem] px-1 rounded-full bg-rose-600 text-white text-xs font-semibold">
                    {group.unreadCount > 9 ? "9+" : group.unreadCount}
                  </span>
                )}
              </div>
              <div>
                <p className="font-medium">{u?.displayName}</p>
                <p className="text-xs text-muted-foreground">
                  {statusCount > 1 ? `${statusCount} updates • ${timeAgo(group.latest.createdAt)}` : timeAgo(group.latest.createdAt)}
                </p>
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
