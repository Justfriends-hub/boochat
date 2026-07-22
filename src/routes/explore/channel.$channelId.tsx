import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/UserAvatar";
import { EmptyState } from "@/components/EmptyState";
import { getChannel } from "@/api/channelsApi";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/explore/channel/$channelId")({
  loader: async ({ params }) => {
    try {
      const channel = await getChannel(params.channelId);
      if (!channel) {
        return { channel: null, error: "Channel not found" };
      }
      return { channel, error: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load channel";
      return { channel: null, error: message };
    }
  },
  component: ChannelPreview,
});

function ChannelPreview() {
  const { channelId } = Route.useParams();
  const me = useAuth();
  const loaderData = Route.useLoaderData() as { channel: any; error: string | null };
  
  const channel = loaderData.channel;
  const error = loaderData.error;

  if (error || !channel) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center p-6 bg-background text-foreground">
        <div className="max-w-md text-center">
          <h1 className="text-2xl font-bold">Channel not found</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {error || "This channel link is invalid or the channel no longer exists."}
          </p>
          <a href="/" className="mt-6 inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
            Go home
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-6 bg-background text-foreground">
      <div className="w-full max-w-2xl space-y-6 rounded-3xl border bg-card p-6 shadow-lg">
        <div className="flex items-center gap-4">
          <UserAvatar name={channel.name} src={channel.avatar} size={56} />
          <div>
            <h1 className="text-2xl font-semibold">{channel.name}</h1>
            <p className="text-sm text-muted-foreground">{channel.description || "No description"}</p>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-2xl border bg-muted p-4">
            <p className="text-xs uppercase text-muted-foreground">Subscribers</p>
            <p className="mt-2 text-lg font-semibold">{channel.memberIds.length}</p>
          </div>
          <div className="rounded-2xl border bg-muted p-4">
            <p className="text-xs uppercase text-muted-foreground">Owner ID</p>
            <p className="mt-2 text-xs font-mono">{channel.ownerId.slice(0, 8)}…</p>
          </div>
          <div className="rounded-2xl border bg-muted p-4">
            <p className="text-xs uppercase text-muted-foreground">Created</p>
            <p className="mt-2 text-lg font-semibold">{new Date(channel.createdAt).toLocaleDateString()}</p>
          </div>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm text-muted-foreground">This is a preview page for the shared channel link.</p>
            <p className="text-sm text-muted-foreground">Sign in to join or subscribe to the channel.</p>
          </div>
          {me ? (
            <Link to="/channels/$channelId" params={{ channelId }}>
              <Button>Open Channel</Button>
            </Link>
          ) : (
            <Link to="/auth/login">
              <Button variant="outline">Log in to join</Button>
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
