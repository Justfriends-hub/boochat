import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Switch } from "@/components/ui/switch";
import { getChannel, updateChannelSettings } from "@/api/channelsApi";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/channels/$channelId/settings/direct-messages")({ component: DirectMessagesPage });

function DirectMessagesPage() {
  const { channelId } = Route.useParams();
  const qc = useQueryClient();
  const { data: channel } = useQuery({ queryKey: ["channel", channelId], queryFn: () => getChannel(channelId) });
  const me = useAuth();

  if (!me || !channel) return null;

  const toggle = async () => {
    try {
      await updateChannelSettings(channel.id, { allowDirectMessages: !channel.allowDirectMessages });
      qc.invalidateQueries({ queryKey: ["channel", channelId] });
      toast.success("Direct messages updated");
    } catch (err: any) {
      toast.error(err.message || "Unable to update");
    }
  };

  return (
    <div className="p-4">
      <h2 className="mb-3 text-lg font-semibold">Direct messages</h2>
      <p className="mb-4 text-sm text-muted-foreground">Allow members to message channel owners and admins.</p>
      <div className="flex items-center justify-between rounded-xl border p-3">
        <div>
          <div className="font-semibold">Allow direct messages</div>
          <div className="text-sm text-muted-foreground">Members can contact channel admins directly.</div>
        </div>
        <Switch checked={channel.allowDirectMessages} onCheckedChange={toggle} />
      </div>
    </div>
  );
}
