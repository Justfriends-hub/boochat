/**
 * syncStore — Zustand store tracking network & sync state
 *
 * Consumed by:
 *   - SyncStatusPill (OfflineBanner) for the 3-state UI
 *   - messagesApi.syncPendingMessages() to set isSyncing/pendingCount
 *   - __root.tsx for the online/offline event listeners
 */
import { create } from "zustand";

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
    // Auto-reset to "online" after 2.5 s
    setTimeout(() => {
      set((s) => ({
        status: s.isOnline && !s.isSyncing ? "online" : s.status,
      }));
    }, 2500);
  },
}));
