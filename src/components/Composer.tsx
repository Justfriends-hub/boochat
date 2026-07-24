import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Send, Paperclip, Mic, X, Smile } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ComposerAttachment =
  | { kind: "image"; file: File; body: string } // body = object URL for preview
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
  onSend: (payload: { kind: "text" | "image" | "voice"; body: string; file?: File; duration?: number }) => void;
  replyTo?: { name: string; body: string } | null;
  onClearReply?: () => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [recording, setRecording] = useState(false);
  const [recordSec, setRecordSec] = useState(0);
  const [pendingImage, setPendingImage] = useState<{ file: File; preview: string } | null>(null);
  const [pendingAudio, setPendingAudio] = useState<{ file: File; preview: string; duration: number } | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const timerRef = useRef<number | null>(null);
  const shouldSendAfterStop = useRef(false);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 128) + "px";
  }, [value]);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
      if (pendingImage) {
        URL.revokeObjectURL(pendingImage.preview);
      }
      if (pendingAudio) {
        URL.revokeObjectURL(pendingAudio.preview);
      }
    };
  }, [pendingImage, pendingAudio]);

  const cleanupPendingImage = () => {
    if (pendingImage) {
      URL.revokeObjectURL(pendingImage.preview);
      setPendingImage(null);
    }
  };

  const cleanupPendingAudio = () => {
    if (pendingAudio) {
      URL.revokeObjectURL(pendingAudio.preview);
      setPendingAudio(null);
    }
  };

  const insertEmoji = () => {
    if (disabled) return;
    const nextValue = value.trim() ? `${value} 😊` : "😊";
    onChange(nextValue);
    textareaRef.current?.focus();
  };

  const send = () => {
    if (pendingAudio) {
      onSend({ kind: "voice", body: pendingAudio.preview, file: pendingAudio.file, duration: pendingAudio.duration });
      cleanupPendingAudio();
      onChange("");
      return;
    }

    if (pendingImage) {
      // If the user typed a caption use it, otherwise send an empty body
      const caption = (typeof value === "string" && value.trim().length) ? value.trim() : "";
      onSend({ kind: "image", body: caption, file: pendingImage.file });
      cleanupPendingImage();
      onChange("");
      return;
    }

    const v = value.trim();
    if (!v) return;
    onSend({ kind: "text", body: v });
    onChange("");
  };

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (pendingImage) {
      URL.revokeObjectURL(pendingImage.preview);
    }
    setPendingImage({ file: f, preview: URL.createObjectURL(f) });
    e.target.value = "";
  };

  const startRec = async () => {
    if (disabled) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      console.warn("Microphone access is not available in this browser.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      chunksRef.current = [];
      setRecordSec(0);
      shouldSendAfterStop.current = false;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        const extension = blob.type.split("/")[1] || "webm";
        const file = new File([blob], `voice-${Date.now()}.${extension}`, { type: blob.type || "audio/webm" });
        const preview = URL.createObjectURL(blob);
        const duration = recordSec;

        setRecording(false);
        setRecordSec(0);
        setPendingAudio({ file, preview, duration });

        if (streamRef.current) {
          streamRef.current.getTracks().forEach((track) => track.stop());
          streamRef.current = null;
        }

        if (shouldSendAfterStop.current && duration > 0) {
          onSend({ kind: "voice", body: preview, file, duration });
          cleanupPendingAudio();
          onChange("");
        }
      };

      recorder.start();
      setRecording(true);
      timerRef.current = window.setInterval(() => {
        setRecordSec((sec) => sec + 1);
      }, 1000);
    } catch (err) {
      console.warn("Unable to start voice recording:", err);
    }
  };

  const stopRec = (sendIt: boolean) => {
    if (!recorderRef.current) return;
    shouldSendAfterStop.current = sendIt;
    recorderRef.current.stop();
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
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
            <span className="text-sm font-mono">
              {String(Math.floor(recordSec / 60)).padStart(2, "0")}:{String(recordSec % 60).padStart(2, "0")}
            </span>
            <span className="flex-1 text-sm text-muted-foreground">Recording…</span>
            <Button size="icon" variant="ghost" onClick={() => stopRec(false)} aria-label="Stop recording and keep audio">
              <X className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button size="icon" onClick={() => stopRec(true)} aria-label="Stop recording and send voice message">
              <Send className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        ) : (
          <>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFile} aria-hidden="true" />
            <Button
              size="icon"
              variant="ghost"
              type="button"
              onClick={() => fileRef.current?.click()}
              aria-label="Attach image"
              className="shrink-0"
            >
              <Paperclip className="h-5 w-5" aria-hidden="true" />
            </Button>
            <div className="flex flex-1 flex-col gap-1">
              {pendingImage && (
                <div className="relative inline-block self-start ml-1">
                  <img
                    src={pendingImage.preview}
                    alt="Attachment preview"
                    className="h-16 w-16 rounded-lg object-cover border"
                  />
                  <button
                    type="button"
                    onClick={cleanupPendingImage}
                    aria-label="Remove attachment"
                    className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-destructive text-destructive-foreground text-xs grid place-items-center"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              )}
              {pendingAudio && (
                <div className="flex items-center gap-3 rounded-2xl border bg-muted px-3 py-2">
                  <audio controls src={pendingAudio.preview} className="flex-1 rounded-lg bg-black/5" />
                  <div className="text-xs text-muted-foreground">
                    {String(Math.floor(pendingAudio.duration / 60)).padStart(2, "0")}:
                    {String(pendingAudio.duration % 60).padStart(2, "0")}
                  </div>
                  <button
                    type="button"
                    onClick={cleanupPendingAudio}
                    aria-label="Discard voice recording"
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              )}
              <div className="flex items-end rounded-3xl border bg-muted px-3 py-1.5">
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
                  placeholder={
                    pendingImage
                      ? "Add a caption… (or just press Send)"
                      : pendingAudio
                      ? "Voice message ready to send"
                      : placeholder
                  }
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
                  onClick={insertEmoji}
                  aria-label="Insert emoji"
                  className="ml-2 shrink-0 text-muted-foreground hover:text-foreground"
                >
                  <Smile className="h-5 w-5" aria-hidden="true" />
                </button>
              </div>
            </div>
            {(pendingAudio || value.trim() || pendingImage) ? (
              <Button size="icon" onClick={send} aria-label="Send message" className="shrink-0 rounded-full">
                <Send className="h-5 w-5" aria-hidden="true" />
              </Button>
            ) : (
              <Button
                size="icon"
                variant="ghost"
                type="button"
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
