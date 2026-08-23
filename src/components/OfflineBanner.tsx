/**
 * SyncStatusPill — replaces the old OfflineBanner.
 *
 * 3-state animated indicator:
 *   🔴 Offline   — red, WifiOff icon, anchored below the status bar
 *   🟡 Syncing…  — amber, spinner, shows while draining the outbox
 *   🟢 Synced    — green, checkmark, fades out after 2.5 s
 *
 * While fully online with nothing to sync the pill is hidden entirely
 * so it never clutters the UI during normal use.
 */
import { useEffect } from "react";
import { WifiOff, RefreshCw, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSyncStore } from "@/stores/syncStore";
import { getPendingCount } from "@/lib/offlineStore";

export function OfflineBanner() {
  const { status, pendingCount, setPendingCount } = useSyncStore();

  // Online/offline transitions are owned by syncStore's connectivity watcher
  // (it verifies with a real probe before celebrating). Here we only keep the
  // pending-message badge in sync.
  useEffect(() => {
    setPendingCount(getPendingCount());
  }, [setPendingCount]);

  // Poll pending count every 3 s (lightweight — just reads an in-memory array)
  useEffect(() => {
    const id = setInterval(() => setPendingCount(getPendingCount()), 3000);
    return () => clearInterval(id);
  }, [setPendingCount]);

  if (status === "online") return null;

  const config = {
    offline: {
      bg: "bg-red-500",
      icon: <WifiOff className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />,
      text: "You're offline — messages will send when reconnected",
      badge: pendingCount > 0 ? `${pendingCount} pending` : null,
    },
    syncing: {
      bg: "bg-emerald-500",
      icon: (
        <RefreshCw
          className="h-3.5 w-3.5 shrink-0 animate-spin"
          aria-hidden="true"
        />
      ),
      text:
        pendingCount > 0
          ? `Back online — sending ${pendingCount} message${pendingCount !== 1 ? "s" : ""}…`
          : "Back online — sending…",
      badge: null,
    },
    synced: {
      bg: "bg-emerald-500",
      icon: <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />,
      text: "Back online",
      badge: null,
    },
  } as const;

  const c = config[status as keyof typeof config];
  if (!c) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "fixed inset-x-0 top-0 z-[100] flex items-center justify-center gap-2 py-1.5 text-xs font-medium text-white shadow-sm transition-all duration-300",
        c.bg,
        status === "synced" && "animate-in fade-in slide-in-from-top-1",
      )}
      style={{ paddingTop: "calc(env(safe-area-inset-top) + 6px)" }}
    >
      {c.icon}
      <span>{c.text}</span>
      {c.badge && (
        <span className="rounded-full bg-white/20 px-1.5 py-0.5 text-[10px]">
          {c.badge}
        </span>
      )}
    </div>
  );
}
