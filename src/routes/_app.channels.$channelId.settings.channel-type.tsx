import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Button } from "@/components/ui/button";
import { getChannel, updateChannel } from "@/api/channelsApi";
import { useAuth } from "@/hooks/useAuth";
import { useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/channels/$channelId/settings/channel-type")({ component: ChannelTypePage });

function ChannelTypePage() {
  const { channelId } = Route.useParams();
  const { data: channel } = useQuery({ queryKey: ["channel", channelId], queryFn: () => getChannel(channelId) });
  const me = useAuth();
  const [saving, setSaving] = useState(false);
  const [value, setValue] = useState<"public" | "private">("public");

  useState(() => {
    if (channel) setValue(channel.visibility);
  });

  if (!me || !channel) return null;

  const save = async () => {
    setSaving(true);
    try {
      await updateChannel(channel.id, { visibility: value });
      toast.success("Channel visibility updated");
    } catch (err: any) {
      toast.error(err.message || "Unable to update");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-4">
      <h2 className="mb-3 text-lg font-semibold">Channel type</h2>
      <p className="mb-4 text-sm text-muted-foreground">Choose whether the channel is public or private.</p>
      <div className="max-w-md">
        <RadioGroup value={value} onValueChange={(v) => setValue(v as any)}>
          <label className="flex items-center gap-3 rounded-xl border p-3">
            <RadioGroupItem value="public" />
            <div>
              <div className="font-semibold">Public</div>
              <div className="text-sm text-muted-foreground">Anyone with the link can join.</div>
            </div>
          </label>
          <label className="flex items-center gap-3 mt-2 rounded-xl border p-3">
            <RadioGroupItem value="private" />
            <div>
              <div className="font-semibold">Private</div>
              <div className="text-sm text-muted-foreground">Membership must be approved by an admin.</div>
            </div>
          </label>
        </RadioGroup>
        <div className="mt-3">
          <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
        </div>
      </div>
    </div>
  );
}
