import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { getChannelStatistics, getChannel } from "@/api/channelsApi";

export const Route = createFileRoute("/_app/channels/$channelId/settings/statistics")({ component: StatisticsPage });

function StatisticsPage() {
  const { channelId } = Route.useParams();
  const { data: channel } = useQuery({ queryKey: ["channel", channelId], queryFn: () => getChannel(channelId) });
  const { data: stats } = useQuery({ queryKey: ["channel-statistics", channelId], queryFn: () => getChannelStatistics(channelId), enabled: !!channel });

  if (!channel) return null;

  return (
    <div className="p-4">
      <h2 className="mb-3 text-lg font-semibold">Statistics</h2>
      <p className="mb-4 text-sm text-muted-foreground">Channel statistics overview.</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border bg-muted p-4 text-center">
          <div className="text-sm text-muted-foreground">Subscribers</div>
          <div className="mt-2 text-xl font-semibold">{stats?.subscribers ?? 0}</div>
        </div>
        <div className="rounded-xl border bg-muted p-4 text-center">
          <div className="text-sm text-muted-foreground">Views</div>
          <div className="mt-2 text-xl font-semibold">{stats?.views ?? 0}</div>
        </div>
        <div className="rounded-xl border bg-muted p-4 text-center">
          <div className="text-sm text-muted-foreground">Reactions</div>
          <div className="mt-2 text-xl font-semibold">{stats?.likes ?? 0}</div>
        </div>
      </div>

      <div className="mt-4 rounded-xl border p-3 bg-card">
        <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Growth</div>
        {stats?.growth?.length ? (
          <div className="mt-3 grid gap-2">
            {stats.growth.map((g) => (
              <div key={g.date} className="flex items-center justify-between text-sm">
                <span>{g.date}</span>
                <span className="font-semibold">{g.members}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-3 text-sm text-muted-foreground">No growth data yet.</div>
        )}
      </div>
    </div>
  );
}
