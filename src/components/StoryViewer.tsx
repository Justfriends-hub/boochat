import { useEffect, useMemo, useRef, useState } from "react";
import { X, Heart, Send, Pause, Play, ChevronLeft, ChevronRight } from "lucide-react";
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

// Preload the next media asset. Returns a cancel() that aborts / discards it.
function preloadMedia(url: string, kind: "image" | "video"): () => void {
  if (kind === "image") {
    const im = new Image();
    im.src = url;
    return () => {
      // Detach handlers & drop src so the browser can cancel the fetch.
      im.onload = null;
      im.onerror = null;
      try { im.src = ""; } catch {}
    };
  }
  const v = document.createElement("video");
  v.preload = "auto";
  v.src = url;
  try { v.load(); } catch {}
  return () => {
    try { v.pause(); v.removeAttribute("src"); v.load(); } catch {}
  };
}

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
  const [paused, setPaused] = useState(false);
  const [reply, setReply] = useState("");
  const [mediaReady, setMediaReady] = useState(false);
  const navigate = useNavigate();
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number>(Date.now());
  const elapsedRef = useRef<number>(0);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  const current = statuses[index];
  const user = users.find((u) => u.id === current?.userId);

  // Preload NEXT media whenever index changes. Cancel on unmount/change.
  useEffect(() => {
    const next = statuses[index + 1];
    if (!next) return;
    const cancel = preloadMedia(next.media, next.kind);
    return cancel;
  }, [index, statuses]);

  // Mark viewed
  useEffect(() => {
    if (current) markStatusViewed(current.id, viewerId);
  }, [current, viewerId]);

  // Reset per-story state
  useEffect(() => {
    setMediaReady(false);
    setProgress(0);
    elapsedRef.current = 0;
    startRef.current = Date.now();
  }, [index]);

  // Progress loop — pauses while media not ready or user paused
  useEffect(() => {
    if (!current) return;
    if (paused || !mediaReady) {
      // freeze timer
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      startRef.current = Date.now();
      return;
    }
    const tick = () => {
      const now = Date.now();
      const delta = now - startRef.current;
      startRef.current = now;
      elapsedRef.current += delta;
      const p = Math.min(1, elapsedRef.current / DURATION_MS);
      setProgress(p);
      if (p >= 1) {
        if (index + 1 < statuses.length) setIndex(index + 1);
        else onClose();
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [index, paused, mediaReady, current, statuses.length, onClose]);

  // Focus mgmt + keyboard controls
  useEffect(() => {
    restoreFocusRef.current = document.activeElement as HTMLElement;
    closeBtnRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
      else if (e.key === "ArrowRight") { e.preventDefault(); goNext(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); goPrev(); }
      else if (e.key === " ") { e.preventDefault(); setPaused((p) => !p); }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      restoreFocusRef.current?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totalCount = statuses.length;
  const activeLabel = useMemo(
    () => `Story ${index + 1} of ${totalCount} by ${user?.displayName ?? "unknown"}`,
    [index, totalCount, user],
  );

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
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label={activeLabel}
      className="fixed inset-0 z-50 flex flex-col bg-black"
    >
      <div className="flex gap-1 p-2" role="group" aria-label="Story progress">
        {statuses.map((_, i) => (
          <div
            key={i}
            className="h-1 flex-1 overflow-hidden rounded bg-white/30"
            role="progressbar"
            aria-label={`Story ${i + 1} of ${totalCount}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={i < index ? 100 : i === index ? Math.round(progress * 100) : 0}
            aria-current={i === index ? "step" : undefined}
          >
            <div
              className="h-full bg-white"
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
        <button
          onClick={() => setPaused((p) => !p)}
          className="rounded-full p-2 hover:bg-white/10"
          aria-label={paused ? "Resume story" : "Pause story"}
        >
          {paused ? <Play className="h-5 w-5" /> : <Pause className="h-5 w-5" />}
        </button>
        <button
          ref={closeBtnRef}
          onClick={onClose}
          className="rounded-full p-2 hover:bg-white/10"
          aria-label="Close story viewer"
        >
          <X className="h-5 w-5" />
        </button>
      </div>
      <div className="relative flex-1">
        {/* Aspect-ratio reservation: 9/16 vertical story frame */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="relative h-full max-h-full aspect-[9/16] w-auto max-w-full bg-neutral-900">
            {!mediaReady && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="h-10 w-10 animate-spin rounded-full border-2 border-white/60 border-t-transparent" aria-label="Loading media" />
              </div>
            )}
            {current.kind === "image" ? (
              <img
                key={current.id}
                src={current.media}
                alt={current.caption || `Story by ${user?.displayName ?? "user"}`}
                onLoad={() => setMediaReady(true)}
                onError={() => setMediaReady(true)}
                className="h-full w-full object-cover"
                draggable={false}
              />
            ) : (
              <video
                key={current.id}
                src={current.media}
                autoPlay
                muted
                playsInline
                onLoadedData={() => setMediaReady(true)}
                onError={() => setMediaReady(true)}
                className="h-full w-full object-cover"
              />
            )}
            {current.caption && mediaReady && (
              <div className="absolute bottom-4 left-0 right-0 px-4 text-center text-white text-sm">
                {current.caption}
              </div>
            )}
          </div>
        </div>
        {/* Tap zones - below the aspect box but above nothing important */}
        <button
          className="absolute inset-y-0 left-0 w-1/3 z-10"
          onClick={goPrev}
          aria-label="Previous story"
        >
          <span className="sr-only">Previous</span>
          <ChevronLeft className="hidden" aria-hidden="true" />
        </button>
        <button
          className="absolute inset-y-0 right-0 w-1/3 z-10"
          onClick={goNext}
          aria-label="Next story"
        >
          <span className="sr-only">Next</span>
          <ChevronRight className="hidden" aria-hidden="true" />
        </button>
      </div>
      <div className="flex items-center gap-2 p-3 bg-black">
        {current.userId !== viewerId && (
          <>
            <label htmlFor="story-reply" className="sr-only">Reply to story</label>
            <Input
              id="story-reply"
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              placeholder="Reply to story…"
              className="bg-white/10 border-white/20 text-white placeholder:text-white/60"
              onKeyDown={(e) => e.key === "Enter" && doReply()}
            />
            <Button size="icon" variant="ghost" onClick={() => doReact("❤️")} aria-label="React with heart" className="text-white hover:text-white hover:bg-white/10">
              <Heart className="h-5 w-5" aria-hidden="true" />
            </Button>
            <Button size="icon" onClick={doReply} aria-label="Send reply">
              <Send className="h-5 w-5" aria-hidden="true" />
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
