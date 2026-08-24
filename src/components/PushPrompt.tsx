import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Bell, X } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import {
  isPushSupported,
  getPermission,
  subscribePush,
} from "@/lib/push";
import { getAppState, setAppState } from "@/lib/offlineStore";

const DISMISS_KEY = "push.prompt.dismissedAt";
const DISMISS_TTL_MS = 7 * 24 * 60 * 60 * 1000; // re-ask after a week

/**
 * WhatsApp-style "Enable notifications" banner.
 *
 * Shows ONLY when: browser supports Web Push, permission is still "default"
 * (never granted/denied), the user is signed in, and the user hasn't
 * dismissed it within the last 7 days. Granting subscribes this device and
 * persists the subscription server-side (see lib/push.ts).
 */
export function PushPrompt() {
  const me = useAuth();
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!isPushSupported()) return;
      if (getPermission() !== "default") return;
      if (!me) return;
      try {
        const dismissedAt = await getAppState<number>(DISMISS_KEY);
        if (dismissedAt && Date.now() - dismissedAt < DISMISS_TTL_MS) return;
      } catch {}
      // Small delay so it never fights the app's first paint
      setTimeout(() => { if (!cancelled) setVisible(true); }, 2500);
    })();
    return () => { cancelled = true; };
  }, [me]);

  if (!visible) return null;

  const dismiss = async () => {
    setVisible(false);
    try { await setAppState(DISMISS_KEY, Date.now()); } catch {}
  };

  const enable = async () => {
    setBusy(true);
    try {
      await subscribePush();
    } catch {} // failures are logged inside push.ts; banner just closes
    setBusy(false);
    setVisible(false);
  };

  return (
    <div className="fixed inset-x-0 bottom-4 z-50 mx-auto flex w-[min(92vw,480px)] items-center gap-3 rounded-2xl border bg-card/95 p-3 shadow-lg backdrop-blur">
      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
        <Bell className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">Turn on notifications?</p>
        <p className="truncate text-xs text-muted-foreground">
          Get message alerts even when boochat is closed — like WhatsApp.
        </p>
      </div>
      <Button size="sm" onClick={enable} disabled={busy}>
        {busy ? "Enabling…" : "Enable"}
      </Button>
      <Button variant="ghost" size="icon" aria-label="Dismiss" onClick={dismiss}>
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}
