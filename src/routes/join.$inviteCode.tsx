import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/UserAvatar";
import { getChannel, listPosts } from "@/api/channelsApi";
import { getChat } from "@/api/chatsApi";
import { listMessages } from "@/api/messagesApi";
import { useAuth } from "@/hooks/useAuth";
import { useEffect } from "react";
import { ArrowRight, Clock3, Globe2, Image as ImageIcon, Lock, MessageSquare, Sparkles, Users } from "lucide-react";

export const Route = createFileRoute("/join/$inviteCode")({
  loader: async ({ params }) => {
    try {
      const channel = await getChannel(params.inviteCode);
      if (channel) {
        const latestPost = channel.visibility === "private" ? null : ((await listPosts(channel.id))[0] ?? null);
        return {
          kind: "channel" as const,
          item: channel,
          latestPost,
          latestMessage: null,
          error: null,
        };
      }

      const chat = await getChat(params.inviteCode);
      if (chat && chat.type === "group") {
        const latestMessage = chat.visibility === "private" ? null : ((await listMessages(chat.id)).slice(-1)[0] ?? null);
        return {
          kind: "group" as const,
          item: chat,
          latestPost: null,
          latestMessage,
          error: null,
        };
      }

      return { kind: null, item: null, latestPost: null, latestMessage: null, error: "This preview link is invalid or no longer available." };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load preview.";
      return { kind: null, item: null, latestPost: null, latestMessage: null, error: message };
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
    latestPost: any;
    latestMessage: any;
    error: string | null;
  };

  const { kind, item, latestPost, latestMessage, error } = data;

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

  const isPrivate = item?.visibility === "private";
  const visibilityLabel = isPrivate ? "Private preview" : "Public preview";
  const accessLabel = isPrivate ? "Private access" : "Preview-only outside the app";

  const latestSnippet = kind === "channel"
    ? latestPost?.body || (isPrivate ? "This private channel is hidden from public preview. Sign in to continue." : "This channel has a fresh post ready for members.")
    : latestMessage?.body || (isPrivate ? "This private group is hidden from public preview. Sign in to continue." : "This group has a fresh update from the community.");

  const latestMedia = kind === "channel" ? latestPost?.image : undefined;
  const latestTimestamp = kind === "channel"
    ? latestPost?.createdAt
    : latestMessage?.createdAt;

  const internalRoute = kind === "channel"
    ? { to: "/channels/$channelId" as const, params: { channelId: inviteCode } }
    : { to: "/groups/$groupId" as const, params: { groupId: inviteCode } };

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(120,119,198,0.25),_transparent_55%),linear-gradient(135deg,#0b1020_0%,#121a2d_45%,#111827_100%)] text-foreground">
      <div className="mx-auto flex min-h-screen max-w-6xl items-center justify-center p-4 sm:p-6 lg:p-8">
        <div className="grid w-full gap-6 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="overflow-hidden rounded-[28px] border border-white/10 bg-card/80 shadow-2xl shadow-slate-950/40 backdrop-blur-xl">
            <div className="relative overflow-hidden border-b border-white/10 bg-gradient-to-br from-primary/20 via-background to-background p-6 sm:p-8">
              <div className="absolute -right-10 -top-10 h-32 w-32 rounded-full bg-primary/30 blur-3xl" />
              <div className="absolute -bottom-10 -left-10 h-36 w-36 rounded-full bg-fuchsia-500/20 blur-3xl" />

              <div className="relative flex items-start gap-4">
                <div className="rounded-2xl border border-white/10 bg-background/80 p-2 shadow-lg shadow-slate-950/20">
                  <UserAvatar name={title} src={item.avatar} size={64} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-primary">
                    <Sparkles className="h-3.5 w-3.5" />
                    {visibilityLabel}
                  </div>
                  <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
                  <p className="mt-2 max-w-xl text-sm text-muted-foreground sm:text-base">{subtitle}</p>
                </div>
              </div>

              <div className="mt-6 grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-white/10 bg-background/70 p-4">
                  <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-muted-foreground">
                    <Users className="h-3.5 w-3.5" /> Members
                  </div>
                  <p className="mt-2 text-2xl font-semibold">{item.memberIds?.length || 0}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-background/70 p-4">
                  <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-muted-foreground">
                    <Lock className="h-3.5 w-3.5" /> Access
                  </div>
                  <p className="mt-2 text-sm font-semibold">{accessLabel}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-background/70 p-4">
                  <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-muted-foreground">
                    <Clock3 className="h-3.5 w-3.5" /> Created
                  </div>
                  <p className="mt-2 text-sm font-semibold">{new Date(item.createdAt).toLocaleDateString()}</p>
                </div>
              </div>
            </div>

            <div className="p-6 sm:p-8">
              <div className="rounded-[24px] border border-white/10 bg-gradient-to-br from-slate-900/90 via-slate-950/80 to-black/80 p-4 sm:p-5">
                <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-primary">
                  <Globe2 className="h-3.5 w-3.5" />
                  {kind === "channel" ? "Latest channel update" : "Latest group message"}
                </div>

                {latestMedia ? (
                  <div className="overflow-hidden rounded-2xl border border-white/10 bg-background/60">
                    <img src={latestMedia} alt="Latest preview media" className="h-56 w-full object-cover" />
                  </div>
                ) : null}

                <div className="mt-4 rounded-2xl border border-white/10 bg-background/60 p-4">
                  <div className="flex items-start gap-3">
                    <div className="rounded-xl bg-primary/10 p-2 text-primary">
                      {kind === "channel" ? <ImageIcon className="h-4 w-4" /> : <MessageSquare className="h-4 w-4" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-4 text-sm leading-6 text-foreground/90">{latestSnippet}</p>
                      {latestTimestamp ? (
                        <p className="mt-3 text-xs text-muted-foreground">{new Date(latestTimestamp).toLocaleString()}</p>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">This is the public preview page for the shared link.</p>
                  <p className="text-sm text-muted-foreground">Sign in to continue into the app and open the full conversation.</p>
                </div>

                {me ? (
                  <Link to={internalRoute.to} params={internalRoute.params}>
                    <Button className="gap-2">
                      Open {kind === "channel" ? "Channel" : "Group"}
                      <ArrowRight className="h-4 w-4" />
                    </Button>
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

          <div className="rounded-[28px] border border-white/10 bg-card/70 p-5 shadow-2xl shadow-slate-950/40 backdrop-blur-xl">
            <div className="rounded-[24px] bg-gradient-to-br from-primary/15 via-background to-background p-4">
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-primary">
                <Sparkles className="h-3.5 w-3.5" />
                Why this preview feels alive
              </div>
              <div className="space-y-3 text-sm text-muted-foreground">
                <div className="rounded-2xl border border-white/10 bg-background/70 p-3">
                  <div className="font-medium text-foreground">Fresh content, not just a shell</div>
                  <p className="mt-1">Public groups and channels show their newest update so visitors instantly understand the vibe.</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-background/70 p-3">
                  <div className="font-medium text-foreground">A cleaner on-ramp to join</div>
                  <p className="mt-1">Authenticated members are sent directly into the real room, while non-members get a polished preview.</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-background/70 p-3">
                  <div className="font-medium text-foreground">Still safe for private spaces</div>
                  <p className="mt-1">The preview keeps the public landing-page language and avoids exposing the full private conversation.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}