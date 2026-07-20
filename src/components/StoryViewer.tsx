import { useEffect, useRef, useState } from "react";
import { X, Heart, Send } from "lucide-react";
import { UserAvatar } from "@/components/UserAvatar";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { markStatusViewed, reactToStatus } from "@/api/statusApi";
import { getOrCreateDM } from "@/api/chatsApi";
import { sendMessage } from "@/api/messagesApi";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import type { Status, User } from "@/lib/mockStore";

const DURATION_MS = 5000;

export function StoryViewer({
  statuses, users, initialIndex, viewerId, onClose,
}: {
  statuses: Status[];
  users: User[];
  initialIndex: number;
  viewerId: string;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(initialIndex);
  const [progress, setProgress] = useState(0);
  const [reply, setReply] = useState("");
  const navigate = useNavigate();
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number>(Date.now());

  const current = statuses[index];
  const user = users.find((u) => u.id === current?.userId);

  useEffect(() => {
    if (!current) return;
    markStatusViewed(current.id, viewerId);
    // Preload next
    const next = statuses[index + 1];
    if (next) {
      if (next.kind === "image") { const im = new Image(); im.src = next.media; }
    }
    startRef.current = Date.now();
    setProgress(0);
    const tick = () => {
      const elapsed = Date.now() - startRef.current;
      const p = Math.min(1, elapsed / DURATION_MS);
      setProgress(p);
      if (p >= 1) {
        if (index + 1 < statuses.length) setIndex(index + 1);
        else onClose();
      } else {
        rafRef.current = requestAnimationFrame(tick);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [index, current, statuses, viewerId, onClose]);

  if (!current) return null;

  const goPrev = () => setIndex((i) => Math.max(0, i - 1));
  const goNext = () => setIndex((i) => (i + 1 < statuses.length ? i + 1 : (onClose(), i)));

  const doReact = (emoji: string) => {
    reactToStatus(current.id, viewerId, emoji);
    toast.success(`Reacted ${emoji}`);
  };

  const doReply = async () => {
    if (!reply.trim() || !user) return;
    const chat = await getOrCreateDM(viewerId, user.id);
    await sendMessage({
      chatId: chat.id, senderId: viewerId, kind: "text",
      body: `Re: your status — ${reply}`,
    });
    setReply("");
    onClose();
    navigate({ to: "/chats/$chatId", params: { chatId: chat.id } });
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      <div className="flex gap-1 p-2">
        {statuses.map((_, i) => (
          <div key={i} className="h-1 flex-1 overflow-hidden rounded bg-white/30">
            <div
              className="h-full bg-white transition-all"
              style={{ width: i < index ? "100%" : i === index ? `${progress * 100}%` : "0%" }}
            />
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 px-3 pb-2 text-white">
        <UserAvatar name={user?.displayName || ""} src={user?.avatar} size={36} />
        <div className="flex-1">
          <p className="text-sm font-semibold">{user?.displayName}</p>
        </div>
        <button onClick={onClose} className="rounded-full p-1 hover:bg-white/10">
          <X className="h-5 w-5" />
        </button>
      </div>
      <div className="relative flex-1">
        <button className="absolute inset-y-0 left-0 w-1/3 z-10" onClick={goPrev} aria-label="Previous" />
        <button className="absolute inset-y-0 right-0 w-1/3 z-10" onClick={goNext} aria-label="Next" />
        {current.kind === "image" ? (
          <img src={current.media} alt="" className="h-full w-full object-contain" />
        ) : (
          <video src={current.media} autoPlay muted className="h-full w-full object-contain" />
        )}
        {current.caption && (
          <div className="absolute bottom-24 left-0 right-0 px-4 text-center text-white text-sm">
            {current.caption}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 p-3 bg-black">
        {current.userId !== viewerId && (
          <>
            <Input
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              placeholder="Reply to story…"
              className="bg-white/10 border-white/20 text-white placeholder:text-white/60"
              onKeyDown={(e) => e.key === "Enter" && doReply()}
            />
            <Button size="icon" variant="ghost" onClick={() => doReact("❤️")} className="text-white hover:text-white hover:bg-white/10">
              <Heart className="h-5 w-5" />
            </Button>
            <Button size="icon" onClick={doReply}>
              <Send className="h-5 w-5" />
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
