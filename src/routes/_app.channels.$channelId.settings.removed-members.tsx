import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { getRemovedMembers, unbanChannelMember, getChannel } from "@/api/channelsApi";
import { UserAvatar } from "@/components/UserAvatar";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/_app/channels/$channelId/settings/removed-members")({ component: RemovedMembersPage });

function RemovedMembersPage() {
  const { channelId } = Route.useParams();
  const qc = useQueryClient();
  const me = useAuth();

  const { data: channel } = useQuery({ queryKey: ["channel", channelId], queryFn: () => getChannel(channelId) });
  const { data: removed = [] } = useQuery({ queryKey: ["channel-removed-members", channelId], queryFn: () => getRemovedMembers(channelId), enabled: !!channel });

  if (!me || !channel) return null;

  const handleRestore = async (userId: string) => {
    try {
      await unbanChannelMember(channel.id, userId);
      qc.invalidateQueries({ queryKey: ["channel-removed-members", channelId] });
      toast.success("Member restored");
    } catch (err: any) {
      toast.error(err.message || "Unable to restore member");
    }
  };

  return (
    <div className="p-4">
      <h2 className="mb-3 text-lg font-semibold">Removed members</h2>
      <p className="mb-4 text-sm text-muted-foreground">Members removed from the channel. You can restore them.</p>
      <div className="space-y-2">
        {removed.length === 0 ? (
          <p className="text-sm text-muted-foreground">No removed members.</p>
        ) : (
          removed.map((m) => (
            <div key={`${m.userId}-${m.removedAt}`} className="flex items-center gap-3 rounded-xl border p-3">
              <UserAvatar name={m.displayName ?? m.userId} src={m.avatar} size={36} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{m.displayName ?? m.userId}</div>
                <div className="text-xs text-muted-foreground">Removed by {m.removedBy ?? "unknown"}</div>
              </div>
              <Button size="sm" onClick={() => handleRestore(m.userId)}>Restore</Button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
