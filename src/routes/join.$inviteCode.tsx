import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/UserAvatar";
import { getChannel } from "@/api/channelsApi";
import { getChat } from "@/api/chatsApi";
import { useAuth } from "@/hooks/useAuth";
import { useEffect } from "react";

export const Route = createFileRoute("/join/$inviteCode")({
  loader: async ({ params }) => {
    try {
      const channel = await getChannel(params.inviteCode);
      if (channel) {
        return { kind: "channel" as const, item: channel, error: null };
      }

      const chat = await getChat(params.inviteCode);
      if (chat && chat.type === "group") {
        return { kind: "group" as const, item: chat, error: null };
      }

      return { kind: null, item: null, error: "This preview link is invalid or no longer available." };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load preview.";
      return { kind: null, item: null, error: message };
    }
  },
  component: JoinPreviewPage,
});

function JoinPreviewPage() {
  const { inviteCode } = Route.useParams();
  const nav = useNavigate();
  const me = useAuth();
  const data = Route.useLoaderData() as {
    kind: "channel" | "group" | null;
    item: any;
    error: string | null;
  };

  const { kind, item, error } = data;

  useEffect(() => {
    if (!me || !item || !kind) return;
    const isMember = item.memberIds?.includes(me.id);
    if (!isMember) return;

    if (kind === "channel") {
      nav({ to: "/channels/$channelId", params: { channelId: inviteCode } });
      return;
    }

    nav({ to: "/groups/$groupId", params: { groupId: inviteCode } });
  }, [inviteCode, kind, item, me, nav]);

  if (error || !item) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center p-6 bg-background text-foreground">
        <div className="max-w-md text-center">
          <h1 className="text-2xl font-bold">Preview unavailable</h1>
          <p className="mt-2 text-sm text-muted-foreground">{error || "This link is invalid or the preview no longer exists."}</p>
          <Link to="/" className="mt-6 inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
            Go home
          </Link>
        </div>
      </div>
    );
  }

  const title = kind === "group" ? item.name || "Group" : item.name;
  const subtitle = kind === "group"
    ? "Shared group preview link"
    : "Shared channel preview link";

  const internalRoute = kind === "channel"
    ? { to: "/channels/$channelId" as const, params: { channelId: inviteCode } }
    : { to: "/groups/$groupId" as const, params: { groupId: inviteCode } };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-6 bg-background text-foreground">
      <div className="w-full max-w-2xl space-y-6 rounded-3xl border bg-card p-6 shadow-lg">
        <div className="flex items-center gap-4">
          <UserAvatar name={title} src={item.avatar} size={56} />
          <div>
            <h1 className="text-2xl font-semibold">{title}</h1>
            <p className="text-sm text-muted-foreground">{subtitle}</p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-2xl border bg-muted p-4">
            <p className="text-xs uppercase text-muted-foreground">Members</p>
            <p className="mt-2 text-lg font-semibold">{item.memberIds?.length || 0}</p>
          </div>
          <div className="rounded-2xl border bg-muted p-4">
            <p className="text-xs uppercase text-muted-foreground">Owner ID</p>
            <p className="mt-2 text-xs font-mono">{item.ownerId?.slice(0, 8) || "n/a"}…</p>
          </div>
          <div className="rounded-2xl border bg-muted p-4">
            <p className="text-xs uppercase text-muted-foreground">Created</p>
            <p className="mt-2 text-lg font-semibold">{new Date(item.createdAt).toLocaleDateString()}</p>
          </div>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm text-muted-foreground">This is the public preview page for the shared link.</p>
            <p className="text-sm text-muted-foreground">Log in to continue into the app and open the full conversation.</p>
          </div>

          {me ? (
            <Link to={internalRoute.to} params={internalRoute.params}>
              <Button>Open {kind === "channel" ? "Channel" : "Group"}</Button>
            </Link>
          ) : (
            <div className="flex flex-col gap-2 sm:flex-row">
              <Link to="/auth/login" search={{ invite: inviteCode }}>
                <Button variant="outline">Log in</Button>
              </Link>
              <Link to="/auth/signup" search={{ invite: inviteCode }}>
                <Button>Create account</Button>
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
