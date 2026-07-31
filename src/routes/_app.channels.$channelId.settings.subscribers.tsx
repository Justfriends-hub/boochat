import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/UserAvatar";
import { getChannelSubscribers, getChannel } from "@/api/channelsApi";
import { useAuth } from "@/hooks/useAuth";
import { ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/_app/channels/$channelId/settings/subscribers")({ component: SubscribersPage });

function SubscribersPage() {
  const { channelId } = Route.useParams();
  const me = useAuth();
  const [search, setSearch] = useState("");
  const [cursor, setCursor] = useState(0);

  const { data: channel } = useQuery({ queryKey: ["channel", channelId], queryFn: () => getChannel(channelId) });
  const { data: page } = useQuery({ queryKey: ["channel-subscribers", channelId, search, cursor], queryFn: () => getChannelSubscribers(channelId, { search, cursor }), enabled: !!channel });

  if (!me || !channel) return null;

  const subscribers = page?.subscribers ?? [];

  return (
    <div className="p-4">
      <div className="mb-4">
        <Link to="/channels/$channelId/settings" params={{ channelId }} className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
      </div>
      <h2 className="mb-3 text-lg font-semibold">Subscribers</h2>
      <p className="mb-4 text-sm text-muted-foreground">View and search channel subscribers.</p>
      <div className="mb-3 max-w-md">
        <Input placeholder="Search subscribers" value={search} onChange={(e) => { setSearch(e.target.value); setCursor(0); }} />
      </div>
      <div className="space-y-2">
        {subscribers.length === 0 ? (
          <p className="text-sm text-muted-foreground">No subscribers found.</p>
        ) : (
          subscribers.map((s) => (
            <div key={s.userId} className="flex items-center gap-3 rounded-xl border p-3">
              <UserAvatar name={s.displayName} src={s.avatar} size={36} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{s.displayName}</div>
                <div className="text-xs text-muted-foreground">{s.email || s.userId}</div>
              </div>
            </div>
          ))
        )}
      </div>
      {page?.nextCursor != null ? <Button className="mt-3" variant="outline" onClick={() => setCursor(page.nextCursor)}>Load more</Button> : null}
    </div>
  );
}
