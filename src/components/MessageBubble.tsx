import { Check, CheckCheck, Play, Pencil, Trash2, Reply, Forward, Clock } from "lucide-react";
import {
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";
import { formatTime } from "@/lib/format";
import type { Message } from "@/lib/mockStore";

export function MessageBubble({
  m, isMine, senderName,
  onReply, onEdit, onDelete, onForward,
  replyToMessage,
}: {
  m: Message;
  isMine: boolean;
  senderName: string;
  onReply?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onForward?: () => void;
  replyToMessage?: Message | null;
}) {
  const deleted = !!m.deletedAt;
  return (
    <div className={cn("flex mb-1.5 px-3", isMine ? "justify-end" : "justify-start")}>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            className={cn(
              "group relative max-w-[78%] rounded-2xl px-3 py-2 text-sm shadow-sm",
              isMine
                ? "rounded-br-sm bg-primary text-primary-foreground"
                : "rounded-bl-sm bg-card text-card-foreground border",
            )}
          >
            {!isMine && (
              <p className="mb-0.5 text-[11px] font-semibold text-primary">{senderName}</p>
            )}
            {m.forwardedFrom && (
              <p className="mb-1 flex items-center gap-1 text-[11px] italic opacity-70">
                <Forward className="h-3 w-3" /> Forwarded
              </p>
            )}
            {replyToMessage && (
              <div className={cn(
                "mb-1.5 rounded-md border-l-2 px-2 py-1 text-xs",
                isMine ? "border-primary-foreground/60 bg-primary-foreground/10" : "border-primary bg-muted",
              )}>
                <p className="truncate opacity-80">{replyToMessage.body || "media"}</p>
              </div>
            )}
            {deleted ? (
              <p className="italic opacity-70">This message was deleted</p>
            ) : m.kind === "image" ? (
              <img src={m.body} alt="" className="max-h-72 rounded-lg" />
            ) : m.kind === "voice" ? (
              <div className="flex flex-col gap-2 py-1">
                <audio controls src={m.body} className="w-full rounded-lg bg-black/5" />
                <span className="text-xs opacity-70">
                  {String(Math.floor((m.duration || 0) / 60)).padStart(2, "0")}:
                  {String((m.duration || 0) % 60).padStart(2, "0")}
                </span>
              </div>
            ) : (
              <p className="whitespace-pre-wrap break-words">{m.body}</p>
            )}
            <div className={cn(
              "mt-0.5 flex items-center justify-end gap-1 text-[10px]",
              isMine ? "text-primary-foreground/70" : "text-muted-foreground",
            )}>
              {m.editedAt && !deleted && <span>edited</span>}
              <span>{formatTime(m.createdAt)}</span>
              {isMine && !deleted && (
                m.status === "pending" ? <Clock className="h-3.5 w-3.5 opacity-70 animate-pulse" />
                : m.status === "read" ? <CheckCheck className="h-3.5 w-3.5 text-sky-300" />
                : m.status === "delivered" ? <CheckCheck className="h-3.5 w-3.5" />
                : <Check className="h-3.5 w-3.5" />
              )}
            </div>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          {onReply && (
            <ContextMenuItem onClick={onReply}>
              <Reply className="mr-2 h-4 w-4" /> Reply
            </ContextMenuItem>
          )}
          {onForward && (
            <ContextMenuItem onClick={onForward}>
              <Forward className="mr-2 h-4 w-4" /> Forward
            </ContextMenuItem>
          )}
          {isMine && !deleted && onEdit && m.kind === "text" && (
            <ContextMenuItem onClick={onEdit}>
              <Pencil className="mr-2 h-4 w-4" /> Edit
            </ContextMenuItem>
          )}
          {isMine && !deleted && onDelete && (
            <ContextMenuItem onClick={onDelete} className="text-destructive">
              <Trash2 className="mr-2 h-4 w-4" /> Delete
            </ContextMenuItem>
          )}
        </ContextMenuContent>
      </ContextMenu>
    </div>
  );
}
