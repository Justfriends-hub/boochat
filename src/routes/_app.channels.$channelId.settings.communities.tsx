import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { getChannel, addChannelToCommunity } from "@/api/channelsApi";
import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/channels/$channelId/settings/communities")({ component: CommunitiesPage });

function CommunitiesPage() {
  const { channelId } = Route.useParams();
  const qc = useQueryClient();
  const { data: channel } = useQuery({ queryKey: ["channel", channelId], queryFn: () => getChannel(channelId) });
  const [value, setValue] = useState("");
  const me = useAuth();

  if (!me || !channel) return null;

  const save = async () => {
    try {
      await addChannelToCommunity(channel.id, value.trim());
      qc.invalidateQueries({ queryKey: ["channel", channelId] });
      toast.success("Channel linked to community");
    } catch (err: any) {
      toast.error(err.message || "Unable to link community");
    }
  };

  return (
    <div className="p-4">
      <h2 className="mb-3 text-lg font-semibold">Communities</h2>
      <p className="mb-4 text-sm text-muted-foreground">Link this channel to a community by ID.</p>
      <div className="space-y-3 max-w-md">
        <div className="rounded-xl border bg-muted p-3 text-sm text-muted-foreground">{channel.communityId ? `Linked: ${channel.communityId}` : "Not linked"}</div>
        <Input placeholder="Community ID" value={value} onChange={(e) => setValue(e.target.value)} />
        <Button onClick={save}>Link community</Button>
      </div>
    </div>
  );
}
