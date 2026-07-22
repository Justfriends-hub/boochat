import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ChatView } from "@/components/ChatView";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { UserAvatar } from "@/components/UserAvatar";
import { Info, LogOut, BellOff, Bell } from "lucide-react";
import { getChat, leaveGroup, updateChat } from "@/api/chatsApi";
import { listUsers } from "@/api/usersApi";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/_app/groups/$groupId")({
  component: GroupChat,
});

function GroupChat() {
  const { groupId } = Route.useParams();
  const me = useAuth()!;
  const nav = useNavigate();
  const [infoOpen, setInfoOpen] = useState(false);
  const { data: chat } = useQuery({ queryKey: ["chat", groupId], queryFn: () => getChat(groupId) });
  const { data: users = [] } = useQuery({ queryKey: ["users"], queryFn: listUsers });

  return (
    <div className="relative flex flex-1 flex-col h-full min-h-0 overflow-hidden">
      <div className="absolute right-4 top-3 z-10">
        <Button variant="ghost" size="icon" onClick={() => setInfoOpen(true)}>
          <Info className="h-5 w-5" />
        </Button>
      </div>
      <ChatView chatId={groupId} />

      <Dialog open={infoOpen} onOpenChange={setInfoOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Group info</DialogTitle></DialogHeader>
          {chat && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <UserAvatar name={chat.name || ""} src={chat.avatar} size={56} />
                <div>
                  <p className="text-lg font-semibold">{chat.name}</p>
                  <p className="text-xs text-muted-foreground">{chat.memberIds.length} members</p>
                </div>
              </div>
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div className="flex items-center gap-2">
                  {chat.muted ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
                  <span className="text-sm">Mute notifications</span>
                </div>
                <Switch checked={!!chat.muted} onCheckedChange={(v) => updateChat(chat.id, { muted: v })} />
              </div>
              <div>
                <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Members</p>
                <ul className="max-h-64 space-y-1 overflow-y-auto">
                  {chat.memberIds.map((id) => {
                    const u = users.find((x) => x.id === id);
                    const isOwner = chat.ownerId === id;
                    const isAdmin = chat.admins?.includes(id);
                    return (
                      <li key={id} className="flex items-center gap-3 rounded-lg p-2">
                        <UserAvatar name={u?.displayName || ""} src={u?.avatar} size={36} online={u?.online} />
                        <div className="flex-1">
                          <p className="text-sm font-medium">{u?.displayName}{id === me.id && " (You)"}</p>
                        </div>
                        {isOwner && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">Owner</span>}
                        {!isOwner && isAdmin && <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold">Admin</span>}
                      </li>
                    );
                  })}
                </ul>
              </div>
              <Button
                variant="destructive" className="w-full"
                onClick={async () => {
                  await leaveGroup(chat.id, me.id);
                  nav({ to: "/groups" });
                }}
              >
                <LogOut className="mr-2 h-4 w-4" /> Leave group
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
