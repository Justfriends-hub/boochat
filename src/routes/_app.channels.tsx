import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { Radio } from "lucide-react";
import { UserAvatar } from "@/components/UserAvatar";
import { EmptyState } from "@/components/EmptyState";
import { FeatureBoundary } from "@/components/FeatureBoundary";
import { listChannels, subscribeToChannels } from "@/api/channelsApi";

export const Route = createFileRoute("/_app/channels")({
  component: ChannelsPage,
  head: () => ({ meta: [{ title: "Channels — Meshly" }] }),
});

function ChannelsPage() {
  const pathname = useRouterState({ select: (s) => s.location?.pathname });
  const qc = useQueryClient();
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

  return (
    <FeatureBoundary name="channels">
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-16 items-center justify-between border-b bg-card px-4">
          <h1 className="text-xl font-semibold">Channels</h1>
        </header>
        <div className="flex-1 overflow-y-auto">
          {channels.length === 0 ? (
            <EmptyState icon={Radio} title="No channels" description="Discover channels to follow." />
          ) : (
            <ul className="p-3 space-y-2">
              {channels.map((c) => (
                <li key={c.id}>
                  <Link
                    to="/channels/$channelId" params={{ channelId: c.id }}
                    className="flex items-center gap-3 rounded-xl border bg-card p-3 hover:bg-muted"
                  >
                    <UserAvatar name={c.name} src={c.avatar} size={48} />
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold">{c.name}</p>
                      <p className="truncate text-sm text-muted-foreground">{c.description}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{c.memberIds.length} subscribers</p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
        <Outlet />
      </div>
    </FeatureBoundary>
  );
}
