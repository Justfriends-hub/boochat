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
  drafts: {},
  setDraft: (chatId, text) => set((s) => ({ drafts: { ...s.drafts, [chatId]: text } })),
  clearDraft: (chatId) => set((s) => {
    const d = { ...s.drafts }; delete d[chatId]; return { drafts: d };
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
