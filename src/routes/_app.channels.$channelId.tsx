import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ArrowLeft, Heart, Eye, MessageSquare, Share2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/UserAvatar";
import { EmptyState } from "@/components/EmptyState";
import { Composer } from "@/components/Composer";
import {
  getChannel, listPosts, togglePostLike, markPostViewed, likeCount, viewCount,
  subscribeToChannels, addComment, listComments, subscribeToComments,
} from "@/api/channelsApi";
import { listUsers } from "@/api/usersApi";
import { useAuth } from "@/hooks/useAuth";
import { useUIStore } from "@/stores/uiStore";
import { timeAgo } from "@/lib/format";
import { toast } from "sonner";
import type { ChannelPost } from "@/lib/mockStore";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";

export const Route = createFileRoute("/_app/channels/$channelId")({
  component: ChannelPage,
});

function ChannelPage() {
  const { channelId } = Route.useParams();
  const router = useRouter();
  const me = useAuth()!;
  const qc = useQueryClient();
  const sessionId = useUIStore((s) => s.sessionId);
  const { data: channel } = useQuery({ queryKey: ["channel", channelId], queryFn: () => getChannel(channelId) });
  const { data: posts = [] } = useQuery({ queryKey: ["posts", channelId], queryFn: () => listPosts(channelId) });
  const { data: users = [] } = useQuery({ queryKey: ["users"], queryFn: listUsers });
  const [openPost, setOpenPost] = useState<ChannelPost | null>(null);

  useEffect(() => subscribeToChannels(() => {
    qc.invalidateQueries({ queryKey: ["posts", channelId] });
    qc.invalidateQueries({ queryKey: ["channel", channelId] });
  }), [channelId, qc]);

  useEffect(() => {
    posts.forEach((p) => markPostViewed(p.id, sessionId));
  }, [posts, sessionId]);

  const doLike = (post: ChannelPost) => {
    qc.setQueryData<ChannelPost[]>(["posts", channelId], (old) =>
      old?.map((p) => p.id === post.id
        ? { ...p, likes: p.likes.includes(me.id) ? p.likes.filter((u) => u !== me.id) : [...p.likes, me.id] }
        : p),
    );
    togglePostLike(post.id, me.id);
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden" style={{ height: "100dvh" }}>
      <header className="flex h-16 items-center gap-3 border-b bg-card px-3">
        <Button variant="ghost" size="icon" onClick={() => router.history.back()}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        {channel && <UserAvatar name={channel.name} src={channel.avatar} size={40} />}
        <div className="flex-1 min-w-0">
          <p className="truncate font-semibold">{channel?.name}</p>
          <p className="truncate text-xs text-muted-foreground">{channel?.memberIds.length} subscribers</p>
        </div>
      </header>
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {posts.length === 0 ? (
          <EmptyState icon={MessageSquare} title="No posts yet" description="Check back later." />
        ) : posts.map((p) => {
          const author = users.find((u) => u.id === p.authorId);
          return (
            <article key={p.id} className="rounded-2xl border bg-card p-4 shadow-sm">
              <header className="mb-2 flex items-center gap-2">
                <UserAvatar name={author?.displayName || ""} src={author?.avatar} size={32} />
                <div className="flex-1">
                  <p className="text-sm font-semibold">{author?.displayName}</p>
                  <p className="text-xs text-muted-foreground">{timeAgo(p.createdAt)}</p>
                </div>
              </header>
              <p className="whitespace-pre-wrap text-sm">{p.body}</p>
              {p.image && <img src={p.image} alt="" className="mt-2 rounded-lg" />}
              <footer className="mt-3 flex items-center gap-4 text-sm text-muted-foreground">
                <button onClick={() => doLike(p)} className="flex items-center gap-1 hover:text-foreground">
                  <Heart className={p.likes.includes(me.id) ? "h-4 w-4 fill-red-500 text-red-500" : "h-4 w-4"} />
                  {likeCount(p)}
                </button>
                <button onClick={() => setOpenPost(p)} className="flex items-center gap-1 hover:text-foreground">
                  <MessageSquare className="h-4 w-4" /> Comments
                </button>
                <span className="flex items-center gap-1"><Eye className="h-4 w-4" /> {viewCount(p)}</span>
                <button
                  onClick={() => {
                    navigator.clipboard?.writeText(window.location.href);
                    toast.success("Link copied");
                  }}
                  className="ml-auto flex items-center gap-1 hover:text-foreground"
                >
                  <Share2 className="h-4 w-4" />
                </button>
              </footer>
            </article>
          );
        })}
      </div>

      <Sheet open={!!openPost} onOpenChange={(o) => !o && setOpenPost(null)}>
        <SheetContent side="bottom" className="h-[80dvh] flex flex-col p-0">
          {openPost && <PostDetail post={openPost} onClose={() => setOpenPost(null)} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function PostDetail({ post, onClose }: { post: ChannelPost; onClose: () => void }) {
  const me = useAuth()!;
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const { data: users = [] } = useQuery({ queryKey: ["users"], queryFn: listUsers });
  const { data: comments = [] } = useQuery({
    queryKey: ["comments", post.id],
    queryFn: () => listComments(post.id),
  });
  useEffect(() => subscribeToComments(post.id, () =>
    qc.invalidateQueries({ queryKey: ["comments", post.id] })), [post.id, qc]);

  return (
    <>
      <SheetHeader className="p-4 border-b">
        <SheetTitle>Post</SheetTitle>
      </SheetHeader>
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        <div className="rounded-lg bg-muted p-3 text-sm whitespace-pre-wrap">{post.body}</div>
        {comments.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No comments yet</p>
        ) : comments.map((c) => {
          const u = users.find((x) => x.id === c.authorId);
          return (
            <div key={c.id} className="flex gap-2">
              <UserAvatar name={u?.displayName || ""} src={u?.avatar} size={32} />
              <div className="flex-1 rounded-lg bg-muted p-2">
                <p className="text-xs font-semibold">{u?.displayName}</p>
                <p className="text-sm">{c.body}</p>
              </div>
            </div>
          );
        })}
      </div>
      <Composer
        value={text}
        onChange={setText}
        onSend={(p) => {
          if (p.kind !== "text") return;
          addComment({ postId: post.id, authorId: me.id, body: p.body });
        }}
        placeholder="Add a comment"
      />
    </>
  );
}
