import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { ArrowLeft, Search, MoreVertical, X, Link2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { UserAvatar } from "@/components/UserAvatar";
import { MessageBubble } from "@/components/MessageBubble";
import { Composer } from "@/components/Composer";
import { EmptyState } from "@/components/EmptyState";
import { MessageCircle } from "lucide-react";
import {
  listMessages, sendMessage, editMessage, deleteMessage, forwardMessage,
  subscribeToChat, subscribeToTyping, markChatRead,
} from "@/api/messagesApi";
import { listChats, getChat, updateChat, requestJoinGroup, approveJoinGroupRequest, rejectJoinGroupRequest } from "@/api/chatsApi";
import { listUsers, getUser } from "@/api/usersApi";
import { useAuth } from "@/hooks/useAuth";
import { useUIStore } from "@/stores/uiStore";
import { formatDay } from "@/lib/format";
import { normalizeRole, type Message, type Chat } from "@/lib/mockStore";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";

export function ChatView({ chatId }: { chatId: string }) {
  const me = useAuth();
  const qc = useQueryClient();
  const router = useRouter();
  const draft = useUIStore((s) => s.drafts[chatId] || "");
  const setDraft = useUIStore((s) => s.setDraft);
  const clearDraft = useUIStore((s) => s.clearDraft);

  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const [editText, setEditText] = useState("");
  const [search, setSearch] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [shareLink, setShareLink] = useState("");
  const [copied, setCopied] = useState(false);
  const [forwarding, setForwarding] = useState<Message | null>(null);
  const [typing, setTyping] = useState<string | null>(null);
  const [privacyBusy, setPrivacyBusy] = useState(false);

  const { data: chat } = useQuery({
    queryKey: ["chat", chatId],
    queryFn: () => getChat(chatId),
  });
  const { data: users = [] } = useQuery({ queryKey: ["users"], queryFn: listUsers });
  const { data: messages = [] } = useQuery({
    queryKey: ["messages", chatId],
    queryFn: () => listMessages(chatId),
  });

  useEffect(() => {
    if (!chat || typeof window === "undefined") return;
    if (chat.type !== "group") return;
    setShareLink(chat.visibility === "private" ? "" : `${window.location.origin}/join/${chat.id}`);
  }, [chat]);

  const copyShareLink = () => {
    if (!shareLink) return;
    navigator.clipboard.writeText(shareLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // ── DM partner resolution ─────────────────────────────────────────────────
  // Step 1: derive the partner's user ID from memberIds
  const otherUserId = useMemo(() => {
    if (!chat || chat.type !== "dm" || !me) return null;
    // memberIds may be UUIDs from Supabase or string IDs from mockStore
    return chat.memberIds.find((x) => x !== me.id) ?? null;
  }, [chat, me]);

  // Step 2: try the pre-loaded users list first (instant, no extra fetch)
  const otherUserFromList = useMemo(
    () => (otherUserId ? users.find((u) => u.id === otherUserId) ?? null : null),
    [otherUserId, users],
  );

  // Step 3: individual fetch as a fallback if the partner isn't in the list yet
  const { data: otherUserFetched } = useQuery({
    queryKey: ["user", otherUserId],
    queryFn: () => (otherUserId ? getUser(otherUserId) : null),
    enabled: !!otherUserId && !otherUserFromList, // skip if already found in list
    staleTime: 60_000,
  });

  // The definitive partner object: list wins over individual fetch (fresher)
  const otherUser = otherUserFromList ?? otherUserFetched ?? null;

  const title = chat?.type === "group"
    ? (chat.name || "Group")
    : (otherUser?.displayName || otherUser?.email?.split("@")[0] || "Loading…");

  const subtitle = chat?.type === "group"
    ? `${chat.memberIds.length} member${chat.memberIds.length !== 1 ? "s" : ""}`
    : typing
      ? "typing…"
      : otherUser?.online
        ? "online"
        : otherUser
          ? "offline"
          : "";

  useEffect(() => {
    const unsub = subscribeToChat(chatId, () => {
      qc.invalidateQueries({ queryKey: ["messages", chatId] });
      qc.invalidateQueries({ queryKey: ["chat", chatId] });
    });
    return () => { unsub(); };
  }, [chatId, qc]);

  useEffect(() => {
    const unsub = subscribeToTyping(chatId, ({ userId, typing }) => {
      setTyping(typing ? userId : null);
    });
    return () => { unsub(); };
  }, [chatId]);

  useEffect(() => {
    if (me) markChatRead(chatId, me.id);
  }, [chatId, me, messages.length]);

  const filtered = useMemo(() => {
    if (!search.trim()) return messages;
    const q = search.toLowerCase();
    return messages.filter((m) => m.body.toLowerCase().includes(q));
  }, [messages, search]);

  // Virtualization
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 64,
    overscan: 8,
  });

  // Auto-scroll to bottom on new message
  const prevLenRef = useRef(0);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (filtered.length !== prevLenRef.current) {
      el.scrollTop = el.scrollHeight;
      prevLenRef.current = filtered.length;
    }
  }, [filtered.length]);

  const doSend = (p: { kind: "text" | "image" | "voice"; body: string; file?: File; duration?: number }) => {
    if (!me) return;
    sendMessage({
      chatId,
      senderId: me.id,
      kind: p.kind,
      body: p.body,
      mediaFile: p.file, // File object from Composer — messagesApi uploads the media
      duration: p.duration,
      replyTo: replyTo?.id,
    });
    setReplyTo(null);
    clearDraft(chatId);
  };

  const canManageVisibility = (normalizeRole(me?.role) === "owner" || normalizeRole(me?.role) === "member") || me?.id === chat?.ownerId;
  const isPrivateGroup = chat?.type === "group" && chat.visibility === "private";
  const isApprovedMember = !!chat && !!me && chat.memberIds.includes(me.id);
  const isPendingJoinRequest = !!chat && !!me && (chat.joinRequests ?? []).some((req) => req.userId === me.id && req.status === "pending");
  const pendingJoinRequests = (chat?.joinRequests ?? []).filter((req) => req.status === "pending");

  const toggleVisibility = async () => {
    if (!chat || !canManageVisibility) return;
    const next = chat.visibility === "private" ? "public" : "private";
    setPrivacyBusy(true);
    try {
      await updateChat(chat.id, { visibility: next });
      qc.invalidateQueries({ queryKey: ["chat", chat.id] });
      toast.success(`Group is now ${next}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to update group visibility.";
      toast.error(message);
    } finally {
      setPrivacyBusy(false);
    }
  };

  const requestJoin = async () => {
    if (!chat || !me) return;
    try {
      await requestJoinGroup(chat.id, me.id);
      qc.invalidateQueries({ queryKey: ["chat", chat.id] });
      toast.success("Join request sent. The owner/admin can approve it.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to send join request.";
      toast.error(message);
    }
  };

  const approveRequest = async (userId: string) => {
    if (!chat || !canManageVisibility) return;
    try {
      await approveJoinGroupRequest(chat.id, userId);
      qc.invalidateQueries({ queryKey: ["chat", chat.id] });
      toast.success("Request approved.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to approve request.";
      toast.error(message);
    }
  };

  const rejectRequest = async (userId: string) => {
    if (!chat || !canManageVisibility) return;
    try {
      await rejectJoinGroupRequest(chat.id, userId);
      qc.invalidateQueries({ queryKey: ["chat", chat.id] });
      toast.success("Request rejected.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to reject request.";
      toast.error(message);
    }
  };

  if (!chat || !me) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (isPrivateGroup && !isApprovedMember && !canManageVisibility) {
    return (
      <div className="flex flex-1 items-center justify-center bg-muted/20 p-6">
        <div className="max-w-md rounded-3xl border bg-card p-6 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Lock className="h-5 w-5" />
          </div>
          <h2 className="text-xl font-semibold">Private group</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            This group is hidden until the owner or admin approves your membership.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">You cannot see the conversation or post inside it yet.</p>
          <Button
            className="mt-4 w-full"
            onClick={requestJoin}
            disabled={isPendingJoinRequest}
          >
            {isPendingJoinRequest ? "Join request pending" : "Request to join"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex flex-1 flex-col h-full min-h-0 overflow-hidden select-none">
      {/* Header - Permanently fixed at top-0 with z-30 so all messages scroll underneath it */}
      <header className="absolute top-0 inset-x-0 z-30 flex h-16 shrink-0 items-center gap-3 border-b bg-card/95 backdrop-blur-md px-3 shadow-xs">
        <Button variant="ghost" size="icon" onClick={() => router.history.back()} className="md:hidden">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <UserAvatar
          src={chat.type === "group" ? chat.avatar : otherUser?.avatar}
          name={title}
          size={40}
          online={otherUser?.online}
        />
        <div className="flex-1 min-w-0">
          <p className="truncate font-semibold text-base md:text-sm">{title}</p>
          <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
        </div>
        <Button variant="ghost" size="icon" onClick={() => setShowSearch((s) => !s)}>
          <Search className="h-5 w-5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => chat?.type === "group" && setInfoOpen(true)}
          disabled={chat?.type !== "group"}
          aria-label={chat?.type === "group" ? "Open group menu" : "More options"}
        >
          <MoreVertical className="h-5 w-5" />
        </Button>
      </header>
      {showSearch && (
        <div className="absolute top-16 inset-x-0 z-20 shrink-0 border-b bg-card/95 backdrop-blur-md p-2">
          <Input
            autoFocus
            placeholder="Search in conversation"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onFocus={() => window.scrollTo(0, 0)}
            className="text-base md:text-sm"
          />
        </div>
      )}

      {/* Messages (only scrollable region, padded top so messages start below header and scroll under it) */}
      <div
        ref={scrollRef}
        className={cn(
          "flex-1 min-h-0 overflow-y-auto overscroll-contain bg-muted/30 pb-3",
          showSearch ? "pt-28" : "pt-16",
        )}
      >
        {filtered.length === 0 ? (
          <EmptyState icon={MessageCircle} title="No messages yet" description="Say hello 👋" />
        ) : (
          <div style={{ height: virtualizer.getTotalSize(), position: "relative", width: "100%" }}>
            {virtualizer.getVirtualItems().map((v) => {
              const m = filtered[v.index];
              const prev = filtered[v.index - 1];
              const sameDay = prev && new Date(prev.createdAt).toDateString() === new Date(m.createdAt).toDateString();
              const sender = users.find((u) => u.id === m.senderId);
              const replyMsg = m.replyTo ? messages.find((x) => x.id === m.replyTo) : null;
              return (
                <div
                  key={m.id}
                  ref={virtualizer.measureElement}
                  data-index={v.index}
                  style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${v.start}px)` }}
                >
                  {!sameDay && (
                    <div className="my-2 flex justify-center">
                      <span className="rounded-full bg-background px-3 py-1 text-xs text-muted-foreground shadow">
                        {formatDay(m.createdAt)}
                      </span>
                    </div>
                  )}
                  <MessageBubble
                    m={m}
                    isMine={m.senderId === me.id}
                    senderName={sender?.displayName || "Unknown"}
                    replyToMessage={replyMsg}
                    onReply={() => setReplyTo(m)}
                    onEdit={() => { setEditing(m); setEditText(m.body); }}
                    onDelete={() => deleteMessage(m.id)}
                    onForward={() => setForwarding(m)}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {chat?.type === "group" && (
        <Dialog open={infoOpen} onOpenChange={setInfoOpen}>
          <DialogContent className="w-full h-full max-w-full sm:max-w-2xl sm:h-auto">
            <DialogHeader>
              <DialogTitle>{chat.name || "Group Info"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-5 p-4">
              <div className="rounded-3xl overflow-hidden bg-muted">
                {chat.avatar ? (
                  <img src={chat.avatar} alt="Group wallpaper" className="w-full h-56 object-cover" />
                ) : (
                  <div className="flex h-56 items-center justify-center bg-slate-200 text-muted-foreground">No wallpaper</div>
                )}
              </div>
              <div className="space-y-4">
                <div>
                  <p className="text-xs font-semibold uppercase text-muted-foreground mb-1">Members</p>
                  <p className="text-lg font-semibold">{chat.memberIds.length}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase text-muted-foreground mb-1">Created</p>
                  <p className="text-sm">{new Date(chat.createdAt).toLocaleDateString()}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase text-muted-foreground mb-1">Description</p>
                  <p className="text-sm text-muted-foreground">{chat.name || "No name"}</p>
                </div>
              </div>
              <div className="rounded-2xl border bg-background p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase text-muted-foreground">Visibility</p>
                    <p className="text-sm text-muted-foreground">
                      {chat.visibility === "private" ? "Private group" : "Public group"}
                    </p>
                  </div>
                  <Switch
                    checked={chat.visibility !== "private"}
                    onCheckedChange={() => toggleVisibility()}
                    disabled={privacyBusy || !canManageVisibility}
                  />
                </div>
              </div>
              {chat.visibility !== "private" && (
                <div className="rounded-2xl border bg-background p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-semibold uppercase text-muted-foreground">Share group link</p>
                    <Button variant="ghost" size="icon" onClick={copyShareLink} disabled={!shareLink}>
                      <Link2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground break-all">{shareLink || "Enable public sharing to generate a preview link."}</p>
                </div>
              )}
              {pendingJoinRequests.length > 0 && canManageVisibility && (
                <div className="rounded-2xl border bg-background p-3">
                  <p className="text-xs font-semibold uppercase text-muted-foreground mb-2">Join requests</p>
                  {pendingJoinRequests.map((request) => {
                    const user = users.find((u) => u.id === request.userId);
                    return (
                      <div key={request.userId} className="flex items-center justify-between gap-3 py-2 border-b last:border-0">
                        <div className="flex items-center gap-2">
                          <UserAvatar name={user?.displayName || ""} src={user?.avatar} size={32} />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium">{user?.displayName}</p>
                            <p className="text-xs text-muted-foreground">{user?.email}</p>
                          </div>
                        </div>
                        <div className="flex-shrink-0">
                          <Button
                            variant="outline"
                            size="icon"
                            onClick={() => approveRequest(request.userId)}
                            disabled={privacyBusy}
                            aria-label="Approve request"
                          >
                            ✓
                          </Button>
                          <Button
                            variant="outline"
                            size="icon"
                            onClick={() => rejectRequest(request.userId)}
                            disabled={privacyBusy}
                            aria-label="Reject request"
                          >
                            ✕
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              {chat.ownerId === me.id && chat.memberIds.length === 1 && (
                <div className="rounded-2xl border bg-background p-3 text-center">
                  <p className="text-sm text-muted-foreground">
                    You are the only member of this group. Invite others to join.
                  </p>
                  <Button variant="outline" onClick={requestJoin} className="mt-2">
                    Invite members
                  </Button>
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}
      <Composer
        value={draft}
        onChange={(v) => setDraft(chatId, v)}
        onSend={doSend}
        replyTo={replyTo ? { name: users.find((u) => u.id === replyTo.senderId)?.displayName || "", body: replyTo.body } : null}
        onClearReply={() => setReplyTo(null)}
      />

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit message</DialogTitle></DialogHeader>
          <Input value={editText} onChange={(e) => setEditText(e.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={() => { if (editing) editMessage(editing.id, editText); setEditing(null); }}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ForwardDialog
        open={!!forwarding}
        onOpenChange={(o) => !o && setForwarding(null)}
        onPick={async (toChatId) => {
          if (forwarding && me) await forwardMessage(forwarding.id, toChatId, me.id);
          setForwarding(null);
        }}
      />
    </div>
  );
}

function ForwardDialog({
  open, onOpenChange, onPick,
}: { open: boolean; onOpenChange: (o: boolean) => void; onPick: (chatId: string) => void }) {
  const me = useAuth();
  const { data: chats = [] } = useQuery({
    queryKey: ["chats", me?.id],
    queryFn: () => (me ? listChats(me.id) : Promise.resolve([] as Chat[])),
    enabled: !!me,
  });
  const { data: users = [] } = useQuery({ queryKey: ["users"], queryFn: listUsers });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Forward to…</DialogTitle>
          <div className="flex justify-end"><X className="hidden" /></div>
        </DialogHeader>
        <div className="max-h-80 space-y-1 overflow-y-auto">
          {chats.map((c) => {
            const name = c.type === "group" ? c.name : users.find((u) => u.id === c.memberIds.find((m) => m !== me?.id))?.displayName;
            return (
              <button
                key={c.id}
                onClick={() => onPick(c.id)}
                className="flex w-full items-center gap-3 rounded-lg p-2 hover:bg-muted text-left"
              >
                <UserAvatar name={name || "?"} src={c.avatar} size={36} />
                <span className="font-medium">{name}</span>
              </button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
