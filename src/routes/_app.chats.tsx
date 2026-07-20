import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, MessageCirclePlus, MessageCircle } from "lucide-react";
import { UserAvatar } from "@/components/UserAvatar";
import { EmptyState } from "@/components/EmptyState";
import { FeatureBoundary } from "@/components/FeatureBoundary";
import { listChats, getOrCreateDM, subscribeToChats } from "@/api/chatsApi";
import { listUsers } from "@/api/usersApi";
import { getState } from "@/lib/mockStore";
import { useAuth } from "@/hooks/useAuth";
import { timeAgo } from "@/lib/format";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/_app/chats")({
  component: ChatsPage,
  head: () => ({ meta: [{ title: "Chats — Meshly" }] }),
});

function ChatsPage() {
  const me = useAuth()!;
  const qc = useQueryClient();
  const nav = useNavigate();
  const [search, setSearch] = useState("");
  const [newChatOpen, setNewChatOpen] = useState(false);

  const { data: chats = [], isLoading } = useQuery({
    queryKey: ["chats", me.id],
    queryFn: () => listChats(me.id),
  });
  const { data: users = [] } = useQuery({ queryKey: ["users"], queryFn: listUsers });

  useEffect(() => {
    const unsub = subscribeToChats(() => qc.invalidateQueries({ queryKey: ["chats", me.id] }));
    return unsub;
  }, [me.id, qc]);

  const rows = useMemo(() => {
    return chats.map((c) => {
      const other = c.type === "dm" ? users.find((u) => u.id === c.memberIds.find((x) => x !== me.id)) : null;
      const name = c.type === "group" ? c.name : other?.displayName || "Chat";
      const avatar = c.type === "group" ? c.avatar : other?.avatar;
      const online = other?.online;
      const last = c.lastMessageId ? getState().messages.find((m) => m.id === c.lastMessageId) : null;
      const unread = getState().messages.filter((m) => m.chatId === c.id && m.senderId !== me.id && m.status !== "read").length;
      return { chat: c, name, avatar, online, last, unread };
    }).filter((r) => !search.trim() || r.name?.toLowerCase().includes(search.toLowerCase()));
  }, [chats, users, me.id, search]);

  return (
    <FeatureBoundary name="chats">
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-16 items-center justify-between border-b bg-card px-4">
          <h1 className="text-xl font-semibold">Chats</h1>
          <Button size="icon" variant="ghost" onClick={() => setNewChatOpen(true)}>
            <MessageCirclePlus className="h-5 w-5" />
          </Button>
        </header>
        <div className="p-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Search chats" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 rounded-full" />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="space-y-2 p-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 rounded-xl p-2">
                  <div className="h-12 w-12 animate-pulse rounded-full bg-muted" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 w-1/3 animate-pulse rounded bg-muted" />
                    <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
                  </div>
                </div>
              ))}
            </div>
          ) : rows.length === 0 ? (
            <EmptyState
              icon={MessageCircle}
              title="No chats yet"
              description="Start a new conversation to say hello."
              action={<Button onClick={() => setNewChatOpen(true)}>Start a chat</Button>}
            />
          ) : (
            <ul>
              {rows.map((r) => (
                <li key={r.chat.id}>
                  <Link
                    to="/chats/$chatId"
                    params={{ chatId: r.chat.id }}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50 active:bg-muted"
                  >
                    <UserAvatar name={r.name || "?"} src={r.avatar} online={r.online} size={48} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline justify-between">
                        <p className="truncate font-semibold">{r.name}</p>
                        {r.last && <span className="text-xs text-muted-foreground">{timeAgo(r.last.createdAt)}</span>}
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-sm text-muted-foreground">
                          {r.last?.kind === "image" ? "📷 Photo" : r.last?.kind === "voice" ? "🎤 Voice message" : (r.last?.body || "No messages yet")}
                        </p>
                        {r.unread > 0 && (
                          <span className="grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground">
                            {r.unread}
                          </span>
                        )}
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <Dialog open={newChatOpen} onOpenChange={setNewChatOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>New chat</DialogTitle></DialogHeader>
            <div className="max-h-80 space-y-1 overflow-y-auto">
              {users.filter((u) => u.id !== me.id).map((u) => (
                <button
                  key={u.id}
                  onClick={async () => {
                    const c = await getOrCreateDM(me.id, u.id);
                    setNewChatOpen(false);
                    nav({ to: "/chats/$chatId", params: { chatId: c.id } });
                  }}
                  className="flex w-full items-center gap-3 rounded-lg p-2 text-left hover:bg-muted"
                >
                  <UserAvatar name={u.displayName} src={u.avatar} online={u.online} size={40} />
                  <div>
                    <p className="font-medium">{u.displayName}</p>
                    <p className="text-xs text-muted-foreground">{u.email}</p>
                  </div>
                </button>
              ))}
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </FeatureBoundary>
  );
}
