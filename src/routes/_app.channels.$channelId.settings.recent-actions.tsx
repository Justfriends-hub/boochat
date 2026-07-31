import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { getChannelRecentActions, getChannel } from "@/api/channelsApi";
import { ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/_app/channels/$channelId/settings/recent-actions")({ component: RecentActionsPage });

function RecentActionsPage() {
  const { channelId } = Route.useParams();
  const { data: channel } = useQuery({ queryKey: ["channel", channelId], queryFn: () => getChannel(channelId) });
  const { data: actions = [] } = useQuery({ queryKey: ["channel-recent-actions", channelId], queryFn: () => getChannelRecentActions(channelId), enabled: !!channel });

  if (!channel) return null;

  const byDate = actions.reduce<Record<string, typeof actions>>((acc, a) => {
    const d = new Date(a.createdAt).toDateString();
    acc[d] = acc[d] || [];
    acc[d].push(a);
    return acc;
  }, {} as any);

  return (
    <div className="p-4">
      <div className="mb-4">
        <Link to="/channels/$channelId/settings" params={{ channelId }} className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
      </div>
      <h2 className="mb-3 text-lg font-semibold">Recent actions</h2>
      <p className="mb-4 text-sm text-muted-foreground">Audit log entries for this channel.</p>
      <div className="space-y-4">
        {Object.keys(byDate).length === 0 ? (
          <div className="text-sm text-muted-foreground">No recent actions.</div>
        ) : (
          Object.entries(byDate).map(([date, list]) => (
            <div key={date} className="space-y-2">
              <div className="text-xs text-muted-foreground">{date}</div>
              <div className="space-y-2">
                {list.map((a) => (
                  <div key={a.id} className="rounded-xl border p-3">
                    <div className="font-medium">{a.action}</div>
                    <div className="text-xs text-muted-foreground">By {a.adminId ?? 'system'} · {new Date(a.createdAt).toLocaleTimeString()}</div>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
