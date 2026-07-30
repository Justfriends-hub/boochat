import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { getChannel, setChannelDiscussion } from "@/api/channelsApi";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/channels/$channelId/settings/discussion")({ component: DiscussionPage });

function DiscussionPage() {
  const { channelId } = Route.useParams();
  const qc = useQueryClient();
  const me = useAuth();
  const { data: channel } = useQuery({ queryKey: ["channel", channelId], queryFn: () => getChannel(channelId) });
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (channel) setValue(channel.discussionChatId ?? "");
  }, [channel]);

  if (!me || !channel) return null;

  const save = async () => {
    setSaving(true);
    try {
      await setChannelDiscussion(channel.id, value.trim() || null);
      qc.invalidateQueries({ queryKey: ["channel", channelId] });
      toast.success("Discussion updated");
    } catch (err: any) {
      toast.error(err.message || "Unable to update discussion");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-4">
      <h2 className="mb-3 text-lg font-semibold">Discussion thread</h2>
      <p className="mb-4 text-sm text-muted-foreground">Link or unlink a discussion chat for this channel.</p>
      <div className="max-w-md space-y-3">
        <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder="Discussion chat ID or leave blank" />
        <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
      </div>
    </div>
  );
}
