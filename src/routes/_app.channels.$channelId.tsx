import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, useRef } from "react";
import { ArrowLeft, Heart, Eye, MessageSquare, Share2, Image as ImageIcon, Send, ShieldCheck, Lock, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/UserAvatar";
import { EmptyState } from "@/components/EmptyState";
import { Composer } from "@/components/Composer";
import {
  getChannel, listPosts, createPost, togglePostLike, markPostViewed, likeCount, viewCount,
  subscribeToChannels, addComment, listComments, subscribeToComments, toggleChannelSubscribe,
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

  const [openPost, setOpenPost] = useState<ChannelPost | null>(null);
  const [postText, setPostText] = useState("");
  const [postImage, setPostImage] = useState<string | undefined>(undefined);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: channel } = useQuery({ queryKey: ["channel", channelId], queryFn: () => getChannel(channelId) });
  const { data: posts = [] } = useQuery({ queryKey: ["posts", channelId], queryFn: () => listPosts(channelId) });
  const { data: users = [] } = useQuery({ queryKey: ["users"], queryFn: listUsers });

  useEffect(() => subscribeToChannels(() => {
    qc.invalidateQueries({ queryKey: ["posts", channelId] });
    qc.invalidateQueries({ queryKey: ["channel", channelId] });
  }), [channelId, qc]);

  useEffect(() => {
    posts.forEach((p) => markPostViewed(p.id, sessionId));
  }, [posts, sessionId]);

  const isSuperAdmin = me.role === "admin";
  const isOwner = channel?.ownerId === me.id;
  const isAdmin = channel?.adminIds?.includes(me.id);
  const canPost = isSuperAdmin || isOwner || isAdmin;
  const isSubscribed = channel?.memberIds.includes(me.id);

  const handleSubscribe = async () => {
    if (!channel) return;
    await toggleChannelSubscribe(channel.id, me.id);
    qc.invalidateQueries({ queryKey: ["channel", channelId] });
    toast.success(isSubscribed ? "Unsubscribed from channel" : "Subscribed to channel!");
  };

  const handleCreatePost = async () => {
    if (!postText.trim() && !postImage) return;
    if (!canPost) {
      toast.error("Only the channel owner and super admin can post in this channel.");
      return;
    }
    setIsSubmitting(true);
    try {
      await createPost({
        channelId,
        authorId: me.id,
        kind: postImage ? "image" : "text",
        body: postText.trim(),
        image: postImage,
      });
      setPostText("");
      setPostImage(undefined);
      toast.success("Post published!");
    } catch (err: any) {
      toast.error(err.message || "Failed to create post");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setPostImage(String(reader.result));
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const doLike = (post: ChannelPost) => {
    qc.setQueryData<ChannelPost[]>(["posts", channelId], (old) =>
      old?.map((p) => p.id === post.id
        ? { ...p, likes: p.likes.includes(me.id) ? p.likes.filter((u) => u !== me.id) : [...p.likes, me.id] }
        : p),
    );
    togglePostLike(post.id, me.id);
  };

  return (
    <div className="flex flex-1 flex-col h-full min-h-0 overflow-hidden">
      <header className="flex h-16 items-center gap-3 border-b bg-card px-3">
        <Button variant="ghost" size="icon" onClick={() => router.history.back()}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        {channel && <UserAvatar name={channel.name} src={channel.avatar} size={40} />}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="truncate font-semibold">{channel?.name}</p>
            {canPost && <ShieldCheck className="h-4 w-4 text-primary shrink-0" />}
          </div>
          <p className="truncate text-xs text-muted-foreground">{channel?.memberIds.length} subscribers</p>
        </div>
        <Button
          size="icon"
          variant="ghost"
          onClick={() => setInfoOpen(true)}
          className="shrink-0"
        >
          <Info className="h-5 w-5" />
        </Button>
        <Button
          size="sm"
          variant={isSubscribed ? "outline" : "default"}
          onClick={handleSubscribe}
          className="rounded-full shrink-0"
        >
          {isSubscribed ? "Subscribed" : "Subscribe"}
        </Button>
      </header>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {posts.length === 0 ? (
          <EmptyState icon={MessageSquare} title="No posts yet" description="Check back later for updates from channel owner." />
        ) : posts.map((p) => {
          const author = users.find((u) => u.id === p.authorId);
          return (
            <article key={p.id} className="rounded-2xl border bg-card p-4 shadow-sm space-y-2">
              <header className="flex items-center gap-2">
                <UserAvatar name={author?.displayName || ""} src={author?.avatar} size={32} />
                <div className="flex-1">
                  <div className="flex items-center gap-1">
                    <p className="text-sm font-semibold">{author?.displayName}</p>
                    <ShieldCheck className="h-3.5 w-3.5 text-primary" />
                  </div>
                  <p className="text-xs text-muted-foreground">{timeAgo(p.createdAt)}</p>
                </div>
              </header>
              <p className="whitespace-pre-wrap text-sm">{p.body}</p>
              {p.image && <img src={p.image} alt="" className="mt-2 max-h-80 w-full rounded-xl object-cover" />}
              <footer className="mt-3 flex items-center gap-4 text-sm text-muted-foreground pt-1 border-t">
                <button onClick={() => doLike(p)} className="flex items-center gap-1.5 hover:text-foreground font-medium">
                  <Heart className={p.likes.includes(me.id) ? "h-4 w-4 fill-red-500 text-red-500" : "h-4 w-4"} />
                  {likeCount(p)}
                </button>
                <button onClick={() => setOpenPost(p)} className="flex items-center gap-1.5 hover:text-foreground font-medium">
                  <MessageSquare className="h-4 w-4" /> Comments
                </button>
                <span className="flex items-center gap-1 text-xs"><Eye className="h-4 w-4" /> {viewCount(p)}</span>
                <button
                  onClick={() => {
                    navigator.clipboard?.writeText(window.location.href);
                    toast.success("Link copied to clipboard");
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

      {canPost ? (
        <div className="border-t bg-card p-3 space-y-2">
          {postImage && (
            <div className="relative inline-block">
              <img src={postImage} alt="Preview" className="h-20 w-20 rounded-lg object-cover border" />
              <button
                onClick={() => setPostImage(undefined)}
                className="absolute -top-2 -right-2 rounded-full bg-destructive text-destructive-foreground h-5 w-5 text-xs grid place-items-center"
              >
                ✕
              </button>
            </div>
          )}
          <div className="flex items-center gap-2">
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={handleImageSelect} />
            <Button size="icon" variant="ghost" type="button" onClick={() => fileRef.current?.click()}>
              <ImageIcon className="h-5 w-5 text-muted-foreground" />
            </Button>
            <input
              type="text"
              placeholder="Post an update to channel..."
              value={postText}
              onChange={(e) => setPostText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleCreatePost()}
              className="flex-1 bg-muted rounded-full px-4 py-2 text-sm outline-none focus:ring-1 focus:ring-primary"
            />
            <Button size="icon" onClick={handleCreatePost} disabled={isSubmitting || (!postText.trim() && !postImage)}>
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ) : (
        <div className="border-t bg-muted/40 p-3 text-center text-xs text-muted-foreground flex items-center justify-center gap-1.5">
          <Lock className="h-3.5 w-3.5" />
          <span>Only the channel owner and super admin can post in this channel. You can react and comment.</span>
        </div>
      )}

      <Sheet open={!!openPost} onOpenChange={(o) => !o && setOpenPost(null)}>
        <SheetContent side="bottom" className="h-[80dvh] flex flex-col p-0">
          {openPost && <PostDetail post={openPost} onClose={() => setOpenPost(null)} />}
        </SheetContent>
      </Sheet>

      <Sheet open={infoOpen} onOpenChange={setInfoOpen}>
        <SheetContent side="bottom" className="h-auto flex flex-col p-0">
          <SheetHeader className="p-4 border-b">
            <SheetTitle>Channel Information</SheetTitle>
          </SheetHeader>
          <div className="p-4 space-y-4">
            {channel && (
              <>
                <div className="flex items-center gap-3">
                  <UserAvatar name={channel.name} src={channel.avatar} size={64} />
                  <div>
                    <h2 className="font-semibold text-lg">{channel.name}</h2>
                    <p className="text-sm text-muted-foreground">{channel.description}</p>
                  </div>
                </div>
                <div className="space-y-2 pt-2">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Total Members</span>
                    <span className="font-semibold">{channel.memberIds.length}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Channel Owner</span>
                    <span className="font-semibold">{users.find((u) => u.id === channel.ownerId)?.displayName || "Unknown"}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Created</span>
                    <span className="font-semibold text-sm">{new Date(channel.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function PostDetail({ post }: { post: ChannelPost; onClose: () => void }) {
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
        <SheetTitle>Comments & Discussion</SheetTitle>
      </SheetHeader>
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        <div className="rounded-xl bg-muted p-3 text-sm whitespace-pre-wrap font-medium">{post.body}</div>
        {comments.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No comments yet. Start the conversation!</p>
        ) : comments.map((c) => {
          const u = users.find((x) => x.id === c.authorId);
          return (
            <div key={c.id} className="flex gap-2">
              <UserAvatar name={u?.displayName || ""} src={u?.avatar} size={32} />
              <div className="flex-1 rounded-xl bg-muted p-2.5">
                <p className="text-xs font-semibold">{u?.displayName}</p>
                <p className="text-sm mt-0.5">{c.body}</p>
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
          setText("");
        }}
        placeholder="Add a comment..."
      />
    </>
  );
}
