import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { getChannel } from "@/api/channelsApi";

export const Route = createFileRoute("/_app/channels/$channelId/settings/appearance")({ component: AppearancePage });

function AppearancePage() {
  const { channelId } = Route.useParams();
  const { data: channel } = useQuery({ queryKey: ["channel", channelId], queryFn: () => getChannel(channelId) });

  if (!channel) return null;

  return (
    <div className="p-4">
      <h2 className="mb-3 text-lg font-semibold">Appearance</h2>
      <p className="mb-4 text-sm text-muted-foreground">Theme and display options — coming soon.</p>
      <div className="rounded-xl border p-4 text-sm text-muted-foreground">Appearance customization is not implemented yet. This page is a placeholder for theme, color, and layout settings.</div>
    </div>
  );
}
