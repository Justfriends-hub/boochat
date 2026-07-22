import { useEffect, useRef, useState } from "react";
import { Send, Paperclip, Mic, X, Smile } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useKeyboardOffset } from "@/hooks/useVisualViewport";

export type ComposerAttachment =
  | { kind: "image"; body: string }
  | { kind: "voice"; body: string; duration: number };

export function Composer({
  value,
  onChange,
  onSend,
  replyTo,
  onClearReply,
  disabled,
  placeholder = "Message",
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: (payload: { kind: "text" | "image" | "voice"; body: string; duration?: number }) => void;
  replyTo?: { name: string; body: string } | null;
  onClearReply?: () => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const kbOffset = useKeyboardOffset();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [recording, setRecording] = useState(false);
  const [recordSec, setRecordSec] = useState(0);
  const recordTimer = useRef<any>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 128) + "px";
  }, [value]);

  const send = () => {
    const v = value.trim();
    if (!v) return;
    onSend({ kind: "text", body: v });
    onChange("");
  };

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      onSend({ kind: "image", body: String(reader.result) });
    };
    reader.readAsDataURL(f);
    e.target.value = "";
  };

  const startRec = () => {
    setRecording(true);
    setRecordSec(0);
    recordTimer.current = setInterval(() => setRecordSec((s) => s + 1), 1000);
  };
  const stopRec = (sendIt: boolean) => {
    clearInterval(recordTimer.current);
    const dur = recordSec;
    setRecording(false);
    setRecordSec(0);
    if (sendIt && dur > 0) onSend({ kind: "voice", body: "voice://mock", duration: dur });
  };

  return (
    <div
      className="shrink-0 border-t bg-background/95 backdrop-blur z-20"
      style={{
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      {replyTo && (
        <div className="flex items-start gap-2 border-l-2 border-primary bg-muted/50 px-3 py-2">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-primary">Replying to {replyTo.name}</p>
            <p className="truncate text-xs text-muted-foreground">{replyTo.body}</p>
          </div>
          <button onClick={onClearReply} aria-label="Cancel reply" className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      )}
      <div className="flex items-end gap-2 px-3 py-2">
        {recording ? (
          <div className="flex flex-1 items-center gap-3 rounded-full bg-destructive/10 px-4 py-2" role="status" aria-live="polite">
            <span className="h-2 w-2 animate-pulse rounded-full bg-destructive" aria-hidden="true" />
            <span className="text-sm font-mono">{String(Math.floor(recordSec / 60)).padStart(2, "0")}:{String(recordSec % 60).padStart(2, "0")}</span>
            <span className="flex-1 text-sm text-muted-foreground">Recording…</span>
            <Button size="icon" variant="ghost" onClick={() => stopRec(false)} aria-label="Discard recording">
              <X className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button size="icon" onClick={() => stopRec(true)} aria-label="Send voice message">
              <Send className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        ) : (
          <>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFile} aria-hidden="true" />
            <Button
              size="icon" variant="ghost" type="button"
              onClick={() => fileRef.current?.click()}
              aria-label="Attach image"
              className="shrink-0"
            >
              <Paperclip className="h-5 w-5" aria-hidden="true" />
            </Button>
            <div className="flex flex-1 items-end rounded-3xl border bg-muted px-3 py-1.5">
              <label htmlFor="composer-input" className="sr-only">Message</label>
              <textarea
                id="composer-input"
                ref={textareaRef}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                onFocus={() => {
                  window.scrollTo(0, 0);
                  if (document.body) document.body.scrollTop = 0;
                }}
                placeholder={placeholder}
                aria-label="Message"
                disabled={disabled}
                rows={1}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  } else if (e.key === "Escape" && (replyTo || value)) {
                    e.preventDefault();
                    if (replyTo) onClearReply?.();
                    else onChange("");
                  }
                }}
                className={cn(
                  "flex-1 resize-none bg-transparent py-1.5 text-base md:text-sm outline-none placeholder:text-muted-foreground",
                )}
                style={{ maxHeight: 128, fontSize: "16px" }}
              />
              <button
                type="button"
                aria-label="Insert emoji"
                className="ml-2 shrink-0 text-muted-foreground hover:text-foreground"
              >
                <Smile className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
            {value.trim() ? (
              <Button size="icon" onClick={send} aria-label="Send message" className="shrink-0 rounded-full">
                <Send className="h-5 w-5" aria-hidden="true" />
              </Button>
            ) : (
              <Button
                size="icon" variant="ghost" type="button"
                onClick={startRec}
                aria-label="Record voice message"
                className="shrink-0 rounded-full"
              >
                <Mic className="h-5 w-5" aria-hidden="true" />
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
