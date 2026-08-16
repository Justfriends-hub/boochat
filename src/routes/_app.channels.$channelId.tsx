import { createFileRoute, Link, Outlet, useRouter, useRouterState } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, useRef, useCallback } from "react";
import { hasBrowserBackHistory } from "@/lib/utils";
import { ArrowLeft, Heart, Eye, MessageSquare, Share2, Image as ImageIcon, Send, ShieldCheck, Lock, Info, Settings, Link as LinkIcon, Copy, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/UserAvatar";
import { EmptyState } from "@/components/EmptyState";
import {
  getChannel, listPosts, createPost, togglePostLike, markPostViewed, likeCount, viewCount,
  subscribeToChannels, addComment, listComments, subscribeToComments, toggleChannelSubscribe, updateChannel,
  addChannelAdmin, removeChannelAdmin, requestJoinChannel, approveJoinChannelRequest, rejectJoinChannelRequest, uploadChannelAvatar,
} from "@/api/channelsApi";
import { listUsers } from "@/api/usersApi";
import { useAuth } from "@/hooks/useAuth";
import { useUIStore } from "@/stores/uiStore";
import { timeAgo } from "@/lib/format";
import { toast } from "sonner";
import { normalizeRole, type ChannelPost } from "@/lib/mockStore";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Composer } from "@/components/Composer";

export const Route = createFileRoute("/_app/channels/$channelId")({
  component: ChannelPage,
});

function ChannelPage() {
  const { channelId } = Route.useParams();
  const router = useRouter();
  const me = useAuth()!;
  const qc = useQueryClient();
  const sessionId = useUIStore((s) => s.sessionId);
  const isSettingsView = useRouterState({
    select: (s) => s.location.pathname.includes(`/channels/${channelId}/settings`),
  });

  const [openPost, setOpenPost] = useState<ChannelPost | null>(null);
  const [postText, setPostText] = useState("");
  const [postImage, setPostImage] = useState<File | undefined>(undefined);
  const [postImagePreview, setPostImagePreview] = useState<string | undefined>(undefined);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [editWallpaper, setEditWallpaper] = useState(false);
  const [wallpaperUrl, setWallpaperUrl] = useState("");
  const [shareLink, setShareLink] = useState("");
  const [copied, setCopied] = useState(false);
  const [privacyBusy, setPrivacyBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const wallpaperFileRef = useRef<HTMLInputElement>(null);

  const { data: channel, isLoading: channelLoading, error: channelError } = useQuery({ queryKey: ["channel", channelId], queryFn: () => getChannel(channelId), staleTime: 30_000, gcTime: 5 * 60 * 1000 });
  const { data: posts = [], isLoading: postsLoading, error: postsError, status: postsStatus } = useQuery({ queryKey: ["posts", channelId], queryFn: () => listPosts(channelId), staleTime: 30_000, gcTime: 5 * 60 * 1000 });
  const { data: users = [] } = useQuery({ queryKey: ["users"], queryFn: listUsers });

  const handleInvalidateQueries = useCallback(() => {
    console.log("🔄 [ChannelPage] Invalidating queries for channel:", channelId);
    qc.invalidateQueries({ queryKey: ["posts", channelId] });
    qc.invalidateQueries({ queryKey: ["channel", channelId] });
  }, [channelId, qc]);

  useEffect(() => {
    const unsub = subscribeToChannels(handleInvalidateQueries);
    return unsub;
  }, [handleInvalidateQueries]);

  useEffect(() => {
    posts.forEach((p) => markPostViewed(p.id, sessionId));
  }, [posts, sessionId]);

  useEffect(() => {
    const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
    setShareLink(channel?.visibility === "private" ? "" : `${baseUrl}/join/${channelId}`);
  }, [channelId, channel?.visibility]);

  const isSiteOwner = normalizeRole(me.role) === "owner";
  const isOwner = channel?.ownerId === me.id;
  const isAdmin = channel?.adminIds?.includes(me.id);
  const canPost = isSiteOwner || isOwner || isAdmin;
  const canManageVisibility = isSiteOwner || isOwner;
  const isSubscribed = channel?.memberIds.includes(me.id);
  const isPrivateChannel = channel?.visibility === "private";
  const isApprovedMember = !!channel && channel.memberIds.includes(me.id);
  const isPendingJoinRequest = !!channel && (channel.joinRequests ?? []).some((req) => req.userId === me.id && req.status === "pending");
  const pendingJoinRequests = (channel?.joinRequests ?? []).filter((req) => req.status === "pending");
  const canViewChannel = !!channel;
  const canViewBoostInfo = isSiteOwner || isOwner || isAdmin;

  const handleSubscribe = async () => {
    if (!channel) return;
    await toggleChannelSubscribe(channel.id, me.id);
    qc.invalidateQueries({ queryKey: ["channel", channelId] });
    qc.invalidateQueries({ queryKey: ["channels"] });
    toast.success(isSubscribed ? "Unsubscribed from channel" : "Subscribed to channel!");
  };

  const handleRequestToJoin = async () => {
    if (!channel) return;
    try {
      await requestJoinChannel(channel.id, me.id);
      qc.invalidateQueries({ queryKey: ["channel", channelId] });
      qc.invalidateQueries({ queryKey: ["channels"] });
      toast.success("Join request sent. The owner/admin can approve it.");
    } catch (err: any) {
      toast.error(err.message || "Failed to request access");
    }
  };

  const handleApproveRequest = async (userId: string) => {
    if (!channel || !canManageVisibility) return;
    try {
      await approveJoinChannelRequest(channel.id, userId);
      qc.invalidateQueries({ queryKey: ["channel", channelId] });
      qc.invalidateQueries({ queryKey: ["channels"] });
      toast.success("Request approved.");
    } catch (err: any) {
      toast.error(err.message || "Failed to approve request");
    }
  };

  const handleRejectRequest = async (userId: string) => {
    if (!channel || !canManageVisibility) return;
    try {
      await rejectJoinChannelRequest(channel.id, userId);
      qc.invalidateQueries({ queryKey: ["channel", channelId] });
      qc.invalidateQueries({ queryKey: ["channels"] });
      toast.success("Request rejected.");
    } catch (err: any) {
      toast.error(err.message || "Failed to reject request");
    }
  };

  const toggleChannelAdminStatus = async (userId: string, grant: boolean) => {
    if (!channel || !canManageVisibility) return;
    try {
      if (grant) {
        await addChannelAdmin(channel.id, userId);
        toast.success("Channel admin granted.");
      } else {
        await removeChannelAdmin(channel.id, userId);
        toast.success("Channel admin revoked.");
      }
      qc.invalidateQueries({ queryKey: ["channel", channelId] });
      qc.invalidateQueries({ queryKey: ["channels"] });
    } catch (err: any) {
      toast.error(err.message || "Failed to update channel admin role");
    }
  };

  const handleToggleVisibility = async () => {
    if (!channel || !canManageVisibility) return;
    const next = channel.visibility === "private" ? "public" : "private";
    setPrivacyBusy(true);
    try {
      await updateChannel(channel.id, { visibility: next });
      qc.invalidateQueries({ queryKey: ["channel", channelId] });
      qc.invalidateQueries({ queryKey: ["channels"] });
      toast.success(`Channel is now ${next}.`);
    } catch (err: any) {
      toast.error(err.message || "Failed to update visibility");
    } finally {
      setPrivacyBusy(false);
    }
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
      qc.invalidateQueries({ queryKey: ["posts", channelId] });
      qc.invalidateQueries({ queryKey: ["channel", channelId] });
      setPostText("");
      setPostImage(undefined);
      if (postImagePreview) URL.revokeObjectURL(postImagePreview);
      setPostImagePreview(undefined);
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
    if (postImagePreview) URL.revokeObjectURL(postImagePreview);
    setPostImage(file);
    setPostImagePreview(URL.createObjectURL(file));
    e.target.value = "";
  };

  const handleWallpaperSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    uploadChannelAvatar(channelId, file)
      .then((signedUrl) => {
        setWallpaperUrl(signedUrl);
        toast.success("Channel wallpaper updated!");
        setEditWallpaper(false);
        qc.invalidateQueries({ queryKey: ["channel", channelId] });
      })
      .catch((err: any) => {
        toast.error(err.message || "Failed to update wallpaper");
      });
  };

  const copyShareLink = () => {
    navigator.clipboard.writeText(shareLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success("Link copied to clipboard!");
  };

  const doLike = (post: ChannelPost) => {
    qc.setQueryData<ChannelPost[]>(["posts", channelId], (old) =>
      old?.map((p) => p.id === post.id
        ? { ...p, likes: (p.likes ?? []).includes(me.id) ? (p.likes ?? []).filter((u) => u !== me.id) : [...(p.likes ?? []), me.id] }
        : p),
    );
    togglePostLike(post.id, me.id);
  };

  if (channelLoading && !channel) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
        Loading channel…
      </div>
    );
  }

  if (!channel) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
        Channel unavailable. Try again.
      </div>
    );
  }

  if (isPrivateChannel && !canViewChannel) {
    return (
      <div className="flex flex-1 items-center justify-center bg-muted/20 p-6">
        <div className="max-w-md rounded-3xl border bg-card p-6 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Lock className="h-5 w-5" />
          </div>
          <h2 className="text-xl font-semibold">Private channel</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            This channel is hidden until the owner or admin approves your membership.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">You cannot see posts or comment until you are accepted.</p>
          <Button
            className="mt-4 w-full"
            onClick={handleRequestToJoin}
            disabled={isPendingJoinRequest}
          >
            {isPendingJoinRequest ? "Join request pending" : "Request to join"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col h-full min-h-0 overflow-hidden">
      <header className="flex h-16 items-center gap-2 border-b bg-card px-3" style={{ backgroundColor: channel?.appearanceColor ?? "#0f172a" }}>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => {
            if (hasBrowserBackHistory()) {
              router.history.back();
            } else {
              router.navigate({ to: "/channels", replace: true });
            }
          }}
        >
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
        {(isOwner || isAdmin) && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.navigate({ to: `/channels/${channelId}/settings` })}
            className="inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm"
            aria-label="Channel settings"
          >
            <Settings className="h-4 w-4" />
            Settings
          </Button>
        )}
        <Button
          size="icon"
          variant="ghost"
          onClick={() => setInfoOpen(true)}
          className="shrink-0"
          aria-label="Channel info"
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
        {isSettingsView ? (
          <Outlet />
        ) : posts.length === 0 ? (
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
                  <Heart className={(p.likes ?? []).includes(me.id) ? "h-4 w-4 fill-red-500 text-red-500" : "h-4 w-4"} />
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
          {postImagePreview && (
            <div className="relative inline-block">
              <img src={postImagePreview} alt="Preview" className="h-20 w-20 rounded-lg object-cover border" />
              <button
                onClick={() => {
                  setPostImage(undefined);
                  if (postImagePreview) URL.revokeObjectURL(postImagePreview);
                  setPostImagePreview(undefined);
                }}
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
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
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
          {openPost && <PostDetail post={openPost} posts={posts} channel={channel} onClose={() => setOpenPost(null)} />}
        </SheetContent>
      </Sheet>

      <Sheet open={infoOpen} onOpenChange={setInfoOpen}>
        <SheetContent side="right" className="w-[50vw] flex flex-col p-0 max-w-2xl">
          <SheetHeader className="p-4 border-b">
            <SheetTitle>Channel Details</SheetTitle>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto p-4 space-y-6">
            {channel && (
              <>
                {/* Wallpaper/Avatar Section */}
                <div className="space-y-3">
                  <div className="relative w-full aspect-video rounded-lg overflow-hidden bg-muted">
                    {channel.avatar && <img src={channel.avatar} alt="" className="w-full h-full object-cover" />}
                  </div>
                  {isOwner && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full gap-2"
                      onClick={() => wallpaperFileRef.current?.click()}
                    >
                      <ImageIcon className="h-4 w-4" />
                      Change Wallpaper
                    </Button>
                  )}
                  <input
                    ref={wallpaperFileRef}
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={handleWallpaperSelect}
                  />
                </div>

                {/* Channel Info */}
                <div className="space-y-3">
                  <div>
                    <p className="text-xs font-semibold uppercase text-muted-foreground mb-1">Name</p>
                    <p className="text-sm font-semibold">{channel.name}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase text-muted-foreground mb-1">Description</p>
                    <p className="text-sm text-muted-foreground">{channel.description || "No description"}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase text-muted-foreground mb-1">Members</p>
                      <p className="text-lg font-semibold">{channel.memberIds.length}</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase text-muted-foreground mb-1">Created</p>
                      <p className="text-sm">{new Date(channel.createdAt).toLocaleDateString()}</p>
                    </div>
                  </div>
                </div>

                {canViewBoostInfo && (
                  <div className="space-y-3 rounded-lg border bg-muted/40 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold uppercase text-muted-foreground">Boost Insights</p>
                        <p className="text-sm text-muted-foreground">Metrics only visible to the owner and delegated channel admins.</p>
                      </div>
                      <div className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">Admin View</div>
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div className="rounded-xl bg-background p-3">
                        <p className="text-xs uppercase text-muted-foreground mb-1">Total likes</p>
                        <p className="text-lg font-semibold">{posts.reduce((sum, p) => sum + p.likes.length + (p.boostedLikes ?? 0), 0)}</p>
                      </div>
                      <div className="rounded-xl bg-background p-3">
                        <p className="text-xs uppercase text-muted-foreground mb-1">Total views</p>
                        <p className="text-lg font-semibold">{posts.reduce((sum, p) => sum + p.views.length + (p.boostedViews ?? 0), 0)}</p>
                      </div>
                      <div className="rounded-xl bg-background p-3">
                        <p className="text-xs uppercase text-muted-foreground mb-1">Boosted likes</p>
                        <p className="text-lg font-semibold">{posts.reduce((sum, p) => sum + (p.boostedLikes ?? 0), 0)}</p>
                      </div>
                      <div className="rounded-xl bg-background p-3">
                        <p className="text-xs uppercase text-muted-foreground mb-1">Boosted views</p>
                        <p className="text-lg font-semibold">{posts.reduce((sum, p) => sum + (p.boostedViews ?? 0), 0)}</p>
                      </div>
                    </div>
                  </div>
                )}

                {(isOwner || isSiteOwner) && (
                  <div className="space-y-3 rounded-lg border bg-muted/40 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold uppercase text-muted-foreground">Channel Admins</p>
                        <p className="text-sm text-muted-foreground">Grant or revoke channel admin rights for members.</p>
                      </div>
                    </div>
                    <div className="space-y-2">
                      {channel.memberIds.map((memberId) => {
                        const user = users.find((u) => u.id === memberId);
                        if (!user) return null;
                        const isMemberAdmin = channel.adminIds.includes(user.id);
                        const isOwnerLabel = user.id === channel.ownerId;
                        return (
                          <div key={user.id} className="flex items-center justify-between gap-3 rounded-xl bg-background p-3">
                            <div>
                              <p className="font-medium text-sm">{user.displayName || user.email}</p>
                              <p className="text-xs text-muted-foreground">
                                {isOwnerLabel ? 'Owner' : isMemberAdmin ? 'Channel Admin' : 'Member'}
                              </p>
                            </div>
                            {!isOwnerLabel && (
                              <Button
                                size="sm"
                                variant={isMemberAdmin ? 'outline' : 'default'}
                                onClick={() => toggleChannelAdminStatus(user.id, !isMemberAdmin)}
                              >
                                {isMemberAdmin ? 'Revoke admin' : 'Grant admin'}
                              </Button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Visibility Section */}
                <div className="space-y-3 rounded-lg border bg-muted/40 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase text-muted-foreground">Visibility</p>
                      <p className="text-sm text-muted-foreground">
                        {channel.visibility === "private" ? "Private channel" : "Public channel"}
                      </p>
                    </div>
                    <Switch
                      checked={channel.visibility !== "private"}
                      onCheckedChange={handleToggleVisibility}
                      disabled={!canManageVisibility || privacyBusy}
                    />
                  </div>
                </div>

                {/* Share Link Section */}
                {channel.visibility !== "private" && (
                  <div className="space-y-2 p-3 rounded-lg bg-muted/50">
                    <p className="text-xs font-semibold uppercase text-muted-foreground">Share Channel</p>
                    <p className="text-xs text-muted-foreground">Anyone with this link can preview this channel</p>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={shareLink}
                        readOnly
                        className="flex-1 text-sm px-2 py-1.5 rounded bg-background border border-input"
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={copyShareLink}
                        className="gap-1"
                      >
                        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>
                )}

                {/* Join Requests Section */}
                {isOwner && channel.visibility === "private" && (
                  <div className="space-y-3 rounded-lg border bg-muted/40 p-3">
                    <p className="text-xs font-semibold uppercase text-muted-foreground mb-2">Join Requests</p>
                    {(channel.joinRequests ?? []).length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-4">No pending join requests</p>
                    ) : (
                      (channel.joinRequests ?? []).map((request) => {
                        const requester = users.find((u) => u.id === request.userId);
                        return (
                          <div key={request.userId} className="flex items-center justify-between gap-2 p-2 rounded-lg hover:bg-muted">
                            <div className="flex items-center gap-2">
                              <UserAvatar name={requester?.displayName || ""} src={requester?.avatar} size={32} />
                              <div className="flex flex-col">
                                <p className="text-sm font-semibold">{requester?.displayName}</p>
                                <p className="text-xs text-muted-foreground">{requester?.email}</p>
                              </div>
                            </div>
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                variant="default"
                                onClick={async () => {
                                  if (!channel) return;
                                  await approveJoinChannelRequest(channel.id, request.userId);
                                  qc.invalidateQueries({ queryKey: ["channel", channelId] });
                                  toast.success(`Approved ${requester?.displayName || "member"}'s request`);
                                }}
                              >
                                Approve
                              </Button>
                              <Button
                                size="sm"
                                variant="destructive"
                                onClick={async () => {
                                  if (!channel) return;
                                  await rejectJoinChannelRequest(channel.id, request.userId);
                                  qc.invalidateQueries({ queryKey: ["channel", channelId] });
                                  toast.success(`Rejected ${requester?.displayName || "member"}'s request`);
                                }}
                              >
                                Reject
                              </Button>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function PostDetail({ post, posts, channel, onClose }: { post: ChannelPost; posts: ChannelPost[]; channel?: any; onClose: () => void }) {
  const me = useAuth()!;
  const qc = useQueryClient();
  const { data: users = [] } = useQuery({ queryKey: ["users"], queryFn: listUsers });

  // Refs for DOM-managed feed (preserve locked visual system and animations)
  const feedRef = useRef<HTMLDivElement | null>(null);
  const typingRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const [draft, setDraft] = useState("");

  // track rendered comment ids to avoid duplicates
  const rendered = useRef(new Set<string>());

  // determine index of current post in provided posts list (newest first)
  const currentIndex = posts.findIndex((p) => p.id === post.id);
  const nextPostIndexRef = useRef(currentIndex > 0 ? currentIndex - 1 : -1);
  const loadingOlderRef = useRef(false);

  useEffect(() => {
    setDraft("");
    rendered.current.clear();
    if (feedRef.current) {
      const staleNodes = feedRef.current.querySelectorAll('.row, .post-divider');
      staleNodes.forEach((node) => node.remove());
    }
  }, [post.id]);

  // Avatar colors (locked system)
  const avatarColors = ['#e0637a', '#5b8cff', '#3fb27f', '#c98a3e', '#8a63e0'];

  function initials(name?: string) {
    if (!name) return '??';
    return name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  }

  function createRowNode({ id, authorId, text, mine = false }: { id?: string; authorId?: string; text: string; mine?: boolean }) {
    const row = document.createElement('div');
    row.className = 'row enter' + (mine ? ' mine' : '');

    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    avatar.style.background = avatarColors[Math.floor(Math.random() * avatarColors.length)];
    const user = users.find((u) => u.id === authorId);
    avatar.textContent = mine ? 'Y' : initials(user?.displayName);

    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.innerHTML = mine ? `<p></p>` : `<div class="name">${user?.displayName ?? 'Unknown'}</div><p></p>`;
    bubble.querySelector('p')!.textContent = text;

    if (!mine) row.appendChild(avatar);
    row.appendChild(bubble);
    if (mine) row.appendChild(avatar);

    if (id) row.dataset.commentId = id;
    return row;
  }

  function showTyping(ms = 1400) {
    const typingRow = typingRef.current!;
    const feed = feedRef.current!;
    const distanceFromBottom = Math.abs(feed.scrollHeight - (feed.scrollTop + feed.clientHeight));
    const atBottom = distanceFromBottom < 48;
    typingRow.classList.add('show');
    if (atBottom) feed.scrollTop = feed.scrollHeight;
    return new Promise<void>((res) => setTimeout(() => {
      typingRow.classList.remove('show');
      res();
    }, ms));
  }

  function addCommentDOM(node: HTMLElement) {
    const feed = feedRef.current!;
    const typingRow = typingRef.current!;
    // insert before typing row so typing stays at bottom
    feed.insertBefore(node, typingRow);
    feed.scrollTop = feed.scrollHeight;
  }

  async function pipelineAddComment(c: { id?: string; authorId?: string; body: string; mine?: boolean }) {
    // avoid re-rendering same comment
    if (c.id && rendered.current.has(c.id)) return;
    await showTyping(1300 + Math.random() * 800);
    const node = createRowNode({ id: c.id, authorId: c.authorId, text: c.body, mine: !!c.mine });
    if (c.id) rendered.current.add(c.id);
    addCommentDOM(node);
  }

  // Load initial comments for the opened post using the unified pipeline (visual-only)
  useEffect(() => {
    let mounted = true;
    (async () => {
      const cs = await listComments(post.id);
      for (const c of cs) {
        if (!mounted) return;
        await pipelineAddComment({ id: c.id, authorId: c.authorId, body: c.body, mine: c.authorId === me.id });
        await new Promise((r) => setTimeout(r, 120));
      }
    })();
    return () => { mounted = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [post.id]);

  // Subscribe to comments for this post and pipeline any new comments
  useEffect(() => {
    const unsub = subscribeToComments(post.id, async () => {
      const cs = await listComments(post.id);
      for (const c of cs) {
        if (!rendered.current.has(c.id)) {
          await pipelineAddComment({ id: c.id, authorId: c.authorId, body: c.body, mine: c.authorId === me.id });
        }
      }
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [post.id]);

  // IntersectionObserver sentinel to load older post comments into same feed
  useEffect(() => {
    const feed = feedRef.current;
    const sentinel = sentinelRef.current;
    if (!feed || !sentinel) return;

    const loadOlderBatch = async () => {
      if (loadingOlderRef.current || nextPostIndexRef.current < 0) return;
      loadingOlderRef.current = true;

      const prevScrollTop = feed.scrollTop;
      const prevScrollHeight = feed.scrollHeight;

      const olderPost = posts[nextPostIndexRef.current];
      if (!olderPost) {
        loadingOlderRef.current = false;
        return;
      }

      const divider = document.createElement('div');
      divider.className = 'post-divider';
      const postOrdinal = `${nextPostIndexRef.current + 2}th post`;
      divider.innerHTML = `
        <span class="post-divider-line"></span>
        <span class="post-divider-content">
          <span class="post-divider-title">Older post</span>
          <span class="post-divider-meta">${postOrdinal} • ${timeAgo(olderPost.createdAt)}</span>
        </span>
        <span class="post-divider-line"></span>
      `;
      feed.insertBefore(divider, typingRef.current);

      const comments = await listComments(olderPost.id);
      for (const c of comments) {
        if (rendered.current.has(c.id)) continue;
        const node = createRowNode({ id: c.id, authorId: c.authorId, text: c.body, mine: c.authorId === me.id });
        feed.insertBefore(node, typingRef.current);
        rendered.current.add(c.id);
        await new Promise((r) => setTimeout(r, 160));
      }

      const newScrollHeight = feed.scrollHeight;
      const delta = newScrollHeight - prevScrollHeight;
      feed.scrollTop = prevScrollTop + delta;

      nextPostIndexRef.current -= 1;
      loadingOlderRef.current = false;
    };

    const io = new IntersectionObserver(async (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          await loadOlderBatch();
        }
      }
    }, { root: feed, threshold: 0.1 });

    io.observe(sentinel);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex, posts, me.id]);

  // Send handler: call addComment API (persist) and rely on subscription to pipeline-add the comment
  const handleSend = async (p: { kind: string; body: string }) => {
    if (p.kind !== 'text') return;
    const trimmed = p.body.trim();
    if (!trimmed) return;
    await addComment({ postId: post.id, authorId: me.id, body: trimmed });
    setDraft("");
    // schedule an automated reply from another channel member (if available)
    const botId = (channel?.memberIds?.find((id: string) => id !== me.id) ?? me.id) as string;
    setTimeout(async () => {
      const replies = [
        "Nice, that reads well!",
        "Love it, very smooth.",
        "That's the elastic curve doing its thing 😄",
        "Clean — exactly the vibe."
      ];
      const reply = replies[Math.floor(Math.random() * replies.length)];
      // persist automated reply as a normal comment author (botId)
      await addComment({ postId: post.id, authorId: botId, body: reply });
    }, 900 + Math.random() * 900);
  };

  return (
    <>
      <style>{`\
  /* Locked visual system copied from dev preview to preserve animations */\
  .row{ display:flex; gap: 10px; align-items: flex-end; }\
  .avatar{ width: 30px; height: 30px; border-radius: 50%; flex-shrink:0; display:flex; align-items:center; justify-content:center; font-size: 12px; font-weight: 700; color: #fff; }\
  .row.enter{ animation: dropIn 0.62s cubic-bezier(0.34, 1.56, 0.64, 1) both; transform-origin: bottom left; }\
  @keyframes dropIn{ 0%{ opacity: 0; transform: translateY(26px) scale(0.85); } 60%{ opacity: 1; transform: translateY(-4px) scale(1.02); } 100%{ opacity: 1; transform: translateY(0) scale(1); } }\
  .bubble{ background: var(--bubble); padding: 10px 14px; border-radius: var(--radius); border-bottom-left-radius: 4px; max-width: 78%; }\
  .row.mine{ justify-content:flex-end; }\
  .row.mine .bubble{ background: var(--accent); border-bottom-left-radius: var(--radius); border-bottom-right-radius: 4px; }\
  .bubble .name{ font-size: 12px; font-weight: 700; color: var(--accent); margin-bottom: 2px; }\
  .row.mine .bubble .name{ display:none; }\
  .bubble p{ margin:0; font-size: 14.5px; line-height: 1.35; color: var(--text); }\
  .typing-row{ display:flex; align-items:center; gap: 10px; height: 0; opacity: 0; overflow: hidden; transition: height 0.35s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.25s ease; }\
  .typing-row.show{ height: 40px; opacity: 1; }\
  .typing-bubble{ background: var(--bubble-alt); border-radius: var(--radius); border-bottom-left-radius: 4px; padding: 11px 16px; display:flex; gap: 5px; align-items:center; }\
  .typing-bubble .dot{ width: 7px; height: 7px; border-radius: 50%; background: var(--text-dim); animation: elasticBounce 1s cubic-bezier(0.45, 0, 0.55, 1) infinite; }\
  .typing-bubble .dot:nth-child(2){ animation-delay: 0.15s; }\
  .typing-bubble .dot:nth-child(3){ animation-delay: 0.3s; }\
  @keyframes elasticBounce{ 0%, 60%, 100%{ transform: translateY(0) scale(1); } 25%{ transform: translateY(-7px) scale(1.15); } }\
  .post-divider{ display:flex; align-items:center; gap:10px; margin: 8px 0 10px; color:var(--text-dim); }\
  .post-divider-line{ flex:1; height:1px; background: rgba(255,255,255,0.08); }\
  .post-divider-content{ display:flex; flex-direction:column; align-items:center; gap:2px; min-width:0; }\
  .post-divider-title{ font-size:11px; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; color:var(--text-dim); }\
  .post-divider-meta{ font-size:11px; color:var(--text-dim); opacity:0.9; }\
`}</style>

      <SheetHeader className="p-4 border-b">
        <SheetTitle>Comments & Discussion</SheetTitle>
      </SheetHeader>

      <div className="flex-1 overflow-y-auto p-4" ref={feedRef}>
        <div className="rounded-xl bg-muted p-3 text-sm whitespace-pre-wrap font-medium">{post.body}</div>

        <div className="typing-row" ref={typingRef}>
          <div className="avatar" style={{ background: '#c98a3e' }}>ZG</div>
          <div className="typing-bubble">
            <span className="dot"></span><span className="dot"></span><span className="dot"></span>
          </div>
        </div>

        <div id="feed-sentinel" ref={sentinelRef} style={{ height: 1 }} />
      </div>

      <Composer
        value={draft}
        onChange={(v) => setDraft(v)}
        onSend={handleSend}
        placeholder="Add a comment..."
      />
    </>
  );
}
