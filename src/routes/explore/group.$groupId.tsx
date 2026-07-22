import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/UserAvatar";
import { EmptyState } from "@/components/EmptyState";
import { getChat } from "@/api/chatsApi";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/explore/group/$groupId")({
  component: GroupPreview,
});

function GroupPreview() {
  const { groupId } = Route.useParams();
  const me = useAuth();
  const { data: chat, isLoading, error: chatError } = useQuery({
    queryKey: ["explore.group", groupId],
    queryFn: () => getChat(groupId),
    retry: 1,
  });

  if (isLoading) {
    return <div className="flex h-full flex-col items-center justify-center gap-4"><div>Loading group…</div></div>;
  }

  if (chatError) {
    console.error("Group preview error:", chatError);
    return <EmptyState title="Unable to load group" description={`Error: ${(chatError as Error).message}`} />;
  }

  if (!chat || chat.type !== "group") {
    return <EmptyState title="Group not found" description="This group link is invalid or the group no longer exists." />;
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-6 bg-background text-foreground">
      <div className="w-full max-w-2xl space-y-6 rounded-3xl border bg-card p-6 shadow-lg">
        <div className="flex items-center gap-4">
          <UserAvatar name={chat.name || "Group"} src={chat.avatar} size={56} />
          <div>
            <h1 className="text-2xl font-semibold">{chat.name || "Group"}</h1>
            <p className="text-sm text-muted-foreground">Shared group preview link</p>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-2xl border bg-muted p-4">
            <p className="text-xs uppercase text-muted-foreground">Members</p>
            <p className="mt-2 text-lg font-semibold">{chat.memberIds.length}</p>
          </div>
          <div className="rounded-2xl border bg-muted p-4">
            <p className="text-xs uppercase text-muted-foreground">Owner ID</p>
            <p className="mt-2 text-xs font-mono">{chat.ownerId?.slice(0, 8)}…</p>
          </div>
          <div className="rounded-2xl border bg-muted p-4">
            <p className="text-xs uppercase text-muted-foreground">Created</p>
            <p className="mt-2 text-lg font-semibold">{new Date(chat.createdAt).toLocaleDateString()}</p>
          </div>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm text-muted-foreground">This is the preview page for the shared group link.</p>
            <p className="text-sm text-muted-foreground">Sign in to view the full group and join the conversation.</p>
          </div>
          {me ? (
            <Link to="/groups/$groupId" params={{ groupId }}>
              <Button>Open Group</Button>
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
