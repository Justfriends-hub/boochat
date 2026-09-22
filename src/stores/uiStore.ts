import { create } from "zustand";

type UIState = {
  drafts: Record<string, string>;
  setDraft: (chatId: string, text: string) => void;
  clearDraft: (chatId: string) => void;
  sessionId: string;
  viewedStatusIds: Set<string>;
  addViewedStatus: (statusId: string) => void;
  hasViewedStatus: (statusId: string) => boolean;
};

function sessionId() {
  if (typeof window === "undefined") return "server";
  let id = sessionStorage.getItem("chatapp.session");
  if (!id) {
    id = Math.random().toString(36).slice(2);
    sessionStorage.setItem("chatapp.session", id);
  }
  return id;
}

// ── Draft persistence ─────────────────────────────────────────────────────
// Composer text (e.g. a half-typed caption on an attached gallery picture)
// used to live only in memory: any reload, PWA background kill, or composer
// remount wiped it and the text "disappeared". Drafts are mirrored to
// localStorage so they survive all of those; sending still clears them.
const DRAFTS_KEY = "boochat.drafts.v1";

function loadDrafts(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(DRAFTS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const clean: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "string" && v.length > 0 && k.length < 100 && v.length < 8000) clean[k] = v;
    }
    return clean;
  } catch {
    return {};
  }
}

function saveDrafts(drafts: Record<string, string>) {
  if (typeof window === "undefined") return;
  try {
    const trimmed: Record<string, string> = {};
    for (const [k, v] of Object.entries(drafts)) {
      if (typeof v === "string" && v.length > 0) trimmed[k] = v.slice(0, 8000);
    }
    localStorage.setItem(DRAFTS_KEY, JSON.stringify(trimmed));
  } catch {}
}

function loadViewedStatuses(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const cached = sessionStorage.getItem("chatapp.viewedStatuses");
    return cached ? new Set(JSON.parse(cached)) : new Set();
  } catch {
    return new Set();
  }
}

function saveViewedStatuses(ids: Set<string>) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem("chatapp.viewedStatuses", JSON.stringify(Array.from(ids)));
  } catch {}
}

export const useUIStore = create<UIState>((set, get) => ({
  drafts: loadDrafts(),
  setDraft: (chatId, text) => set((s) => {
    const drafts = { ...s.drafts };
    if (text && text.length > 0) drafts[chatId] = text;
    else delete drafts[chatId];
    saveDrafts(drafts);
    return { drafts };
  }),
  clearDraft: (chatId) => set((s) => {
    const d = { ...s.drafts }; delete d[chatId]; saveDrafts(d); return { drafts: d };
  }),
  sessionId: sessionId(),
  viewedStatusIds: loadViewedStatuses(),
  addViewedStatus: (statusId: string) => {
    const current = get().viewedStatusIds;
    if (!current.has(statusId)) {
      current.add(statusId);
      saveViewedStatuses(current);
      set({ viewedStatusIds: new Set(current) });
    }
  },
  hasViewedStatus: (statusId: string) => get().viewedStatusIds.has(statusId),
}));
