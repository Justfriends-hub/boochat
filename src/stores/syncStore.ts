/**
 * syncStore — Zustand store tracking network & sync state
 *
 * Consumed by:
 *   - OfflineBanner (SyncStatusPill) for the 4-state UI:
 *       🔴 offline   🟢 sending…   ✅ back online (fades)   hidden when idle
 *   - messagesApi.syncPendingMessages() to set isSyncing/pendingCount
 *
 * Connectivity truthing: the browser's `online` event fires when the radio
 * attaches, BEFORE internet actually works (and can be missed while the app
 * is frozen in background). So transitions are verified with a lightweight
 * probe against Supabase before showing the green "back online" state, and
 * unexpected request failures flip us back to red immediately.
 */
import { create } from "zustand";
import { getPendingCount } from "@/lib/offlineStore";

type SyncStatus = "online" | "syncing" | "synced" | "offline";

interface SyncState {
  /** Raw network status */
  isOnline: boolean;
  /** Currently draining the outbox queue */
  isSyncing: boolean;
  /** Number of messages waiting to be sent */
  pendingCount: number;
  /** Timestamp of last successful sync (ms since epoch) */
  lastSyncedAt: number | null;
  /** Derived status label for the UI pill */
  status: SyncStatus;

  setOnline: (online: boolean) => void;
  setSyncing: (syncing: boolean) => void;
  setPendingCount: (count: number) => void;
  markSynced: () => void;
}

export const useSyncStore = create<SyncState>((set, get) => ({
  isOnline: typeof navigator !== "undefined" ? navigator.onLine : true,
  isSyncing: false,
  pendingCount: 0,
  lastSyncedAt: null,
  status: "online",

  setOnline: (online) => {
    set({
      isOnline: online,
      status: online ? (get().isSyncing ? "syncing" : "online") : "offline",
    });
  },

  setSyncing: (syncing) => {
    set({
      isSyncing: syncing,
      status: !get().isOnline ? "offline" : syncing ? "syncing" : "online",
    });
  },

  setPendingCount: (count) => {
    set({ pendingCount: count });
  },

  markSynced: () => {
    set({ lastSyncedAt: Date.now(), isSyncing: false, status: "synced" });
    // Auto-reset to hidden ("online") after 2.5 s
    setTimeout(() => {
      set((s) => ({
        status: s.isOnline && !s.isSyncing ? "online" : s.status,
      }));
    }, 2500);
  },
}));

// ── Connectivity watcher ─────────────────────────────────────────────────────

/** Outbox drain registered by messagesApi (avoids an import cycle). */
type DrainFn = () => void | Promise<void>;
let drainOutbox: DrainFn | null = null;
export function registerOutboxDrain(fn: DrainFn) {
  drainOutbox = fn;
}

/**
 * Drains for the action outbox (offline channel posts/comments — see
 * offlineStore.addAction). Any module may register; all run on reconnect.
 */
const actionDrainers: DrainFn[] = [];
export function registerActionDrain(fn: DrainFn) {
  actionDrainers.push(fn);
}

/**
 * A real network request just failed unexpectedly (timeout/abort/DNS).
 * The browser still claims we're online — it's lying. Flip to red now;
 * the watcher below will restore green once a probe succeeds.
 */
export function reportNetworkFailure() {
  if (typeof navigator !== "undefined" && !navigator.onLine) return;
  const s = useSyncStore.getState();
  if (s.status === "offline") return;
  s.setOnline(false);
  void verifyAndCelebrate();
}

/** Lightweight reachability probe — ANY real HTTP response counts as online. */
async function probeReachable(): Promise<boolean> {
  const base = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  if (!base || typeof fetch === "undefined") return true; // nothing to probe against
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${base}/auth/v1/health`, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
    });
    clearTimeout(timer);
    return res.status < 500;
  } catch {
    return false;
  }
}

/** Green handshake once connectivity is genuinely verified. */
function runReconnectFlow() {
  const s = useSyncStore.getState();
  s.setOnline(true);

  const pending = getPendingCount();
  s.setPendingCount(pending);

  if (pending > 0 && drainOutbox) {
    // Draining shows the green spinner state, ending in ✅ via markSynced()
    void drainOutbox();
  } else {
    // Nothing to send — flash ✅ Back online briefly, then hide
    s.markSynced();
  }

  // Replay offline-created posts/comments/etc. regardless of message queue.
  actionDrainers.forEach((fn) => {
    try { void fn(); } catch {}
  });
}

let retryTimer: ReturnType<typeof setTimeout> | null = null;

function clearRetryTimer() {
  if (retryTimer !== null) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
}

let verifying = false;

async function verifyAndCelebrate() {
  if (verifying) return; // one probe at a time
  if (typeof navigator === "undefined" || !navigator.onLine) return;
  verifying = true;
  try {
    const reachable = await probeReachable();
    if (!reachable) {
      // Radio up, internet not yet — stay red and keep checking quietly
      useSyncStore.setState({ status: "offline" });
      scheduleVerify();
      return;
    }
    clearRetryTimer();
    runReconnectFlow();
  } finally {
    verifying = false;
  }
}

function scheduleVerify(delayMs = 4000) {
  if (retryTimer !== null) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void verifyAndCelebrate();
  }, delayMs);
}

let watcherStarted = false;

/** Wire browser events exactly once (idempotent — safe for StrictMode). */
export function initConnectivityWatcher() {
  if (watcherStarted || typeof window === "undefined") return;
  watcherStarted = true;

  window.addEventListener("online", () => void verifyAndCelebrate());
  window.addEventListener("offline", () => {
    clearRetryTimer();
    useSyncStore.getState().setOnline(false);
  });

  // Re-evaluate when the app returns to foreground — events are often missed
  // while the PWA is frozen in background.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    const s = useSyncStore.getState();
    if (!navigator.onLine) {
      s.setOnline(false);
      return;
    }
    if (s.status === "offline" || !s.isOnline) void verifyAndCelebrate();
  });

  // Initial state: trust the radio at boot (SW shell load), no celebration
  useSyncStore.getState().setOnline(navigator.onLine);
}
