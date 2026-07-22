import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useRef, useEffect } from "react";
import { ChatView } from "@/components/ChatView";
import { Button } from "@/components/ui/button";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { UserAvatar } from "@/components/UserAvatar";
import { Info, LogOut, BellOff, Bell, Copy, Check, ImageIcon } from "lucide-react";
import { getChat, leaveGroup, updateChat } from "@/api/chatsApi";
import { listUsers } from "@/api/usersApi";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/_app/groups/$groupId")({
  component: GroupChat,
});

function GroupChat() {
  const { groupId } = Route.useParams();
  const me = useAuth()!;
  const nav = useNavigate();
  const qc = useQueryClient();
  const [infoOpen, setInfoOpen] = useState(false);
  const [shareLink, setShareLink] = useState("");
  const [copied, setCopied] = useState(false);
  const wallpaperFileRef = useRef<HTMLInputElement>(null);
  const { data: chat } = useQuery({ queryKey: ["chat", groupId], queryFn: () => getChat(groupId) });
  const { data: users = [] } = useQuery({ queryKey: ["users"], queryFn: listUsers });

  const isOwner = chat?.ownerId === me.id;

  useEffect(() => {
    const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
    setShareLink(`${baseUrl}/explore/group/${groupId}`);
  }, [groupId]);

  const handleWallpaperSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const imageUrl = String(reader.result);
      try {
        await updateChat(groupId, { avatar: imageUrl });
        toast.success("Group wallpaper updated!");
        qc.invalidateQueries({ queryKey: ["chat", groupId] });
      } catch (err: any) {
        toast.error(err.message || "Failed to update wallpaper");
      }
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const copyShareLink = () => {
    navigator.clipboard.writeText(shareLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success("Link copied to clipboard!");
  };

  return (
    <div className="relative flex flex-1 flex-col h-full min-h-0 overflow-hidden">
      <ChatView chatId={groupId} />
      
      {/* Floating info & share buttons */}
      <div className="absolute right-4 top-16 z-20 flex gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            navigator.clipboard.writeText(shareLink);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
            toast.success("Link copied!");
          }}
          className="gap-1"
        >
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setInfoOpen(true)}
          className="gap-1"
        >
          <Info className="h-4 w-4" /> Details
        </Button>
      </div>

      <Sheet open={infoOpen} onOpenChange={setInfoOpen}>
        <SheetContent side="right" className="w-[50vw] flex flex-col p-0 max-w-2xl">
          <SheetHeader className="p-4 border-b">
            <SheetTitle>Group Details</SheetTitle>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto p-4 space-y-6">
            {chat && (
              <>
                {/* Wallpaper/Avatar Section */}
                <div className="space-y-3">
                  <div className="relative w-full aspect-video rounded-lg overflow-hidden bg-muted">
                    {chat.avatar && <img src={chat.avatar} alt="" className="w-full h-full object-cover" />}
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

                {/* Group Info */}
                <div className="space-y-3">
                  <div>
                    <p className="text-xs font-semibold uppercase text-muted-foreground mb-1">Name</p>
                    <p className="text-sm font-semibold">{chat.name}</p>
                  </div>
                  <div className="flex justify-between rounded-lg border p-3">
                    <div className="flex items-center gap-2">
                      {chat.muted ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
                      <span className="text-sm">Mute notifications</span>
                    </div>
                    <Switch checked={!!chat.muted} onCheckedChange={(v) => updateChat(chat.id, { muted: v })} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase text-muted-foreground mb-1">Members</p>
                      <p className="text-lg font-semibold">{chat.memberIds.length}</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase text-muted-foreground mb-1">Created</p>
                      <p className="text-sm">{new Date(chat.createdAt).toLocaleDateString()}</p>
                    </div>
                  </div>
                </div>

                {/* Members List */}
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Members</p>
                  <ul className="max-h-48 space-y-1 overflow-y-auto">
                    {chat.memberIds.map((id) => {
                      const u = users.find((x) => x.id === id);
                      const isChatOwner = chat.ownerId === id;
                      const isAdmin = chat.admins?.includes(id);
                      return (
                        <li key={id} className="flex items-center gap-3 rounded-lg p-2">
                          <UserAvatar name={u?.displayName || ""} src={u?.avatar} size={32} online={u?.online} />
                          <div className="flex-1">
                            <p className="text-sm font-medium">{u?.displayName}{id === me.id && " (You)"}</p>
                          </div>
                          {isChatOwner && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">Owner</span>}
                          {!isChatOwner && isAdmin && <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold">Admin</span>}
                        </li>
                      );
                    })}
                  </ul>
                </div>

                {/* Share Link Section */}
                <div className="space-y-2 p-3 rounded-lg bg-muted/50">
                  <p className="text-xs font-semibold uppercase text-muted-foreground">Share Group</p>
                  <p className="text-xs text-muted-foreground">Anyone with this link can preview this group</p>
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

                <Button
                  variant="destructive" className="w-full mt-auto"
                  onClick={async () => {
                    await leaveGroup(chat.id, me.id);
                    nav({ to: "/groups" });
                  }}
                >
                  <LogOut className="mr-2 h-4 w-4" /> Leave group
                </Button>
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
