import { create } from "zustand";

type UIState = {
  drafts: Record<string, string>;
  setDraft: (chatId: string, text: string) => void;
  clearDraft: (chatId: string) => void;
  sessionId: string;
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

export const useUIStore = create<UIState>((set) => ({
  drafts: {},
  setDraft: (chatId, text) => set((s) => ({ drafts: { ...s.drafts, [chatId]: text } })),
  clearDraft: (chatId) => set((s) => {
    const d = { ...s.drafts }; delete d[chatId]; return { drafts: d };
  }),
  sessionId: sessionId(),
}));
