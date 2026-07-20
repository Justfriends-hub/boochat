import { createFileRoute, redirect } from "@tanstack/react-router";
import { getCurrentUser } from "@/api/authApi";
import { initStore } from "@/lib/mockStore";

export const Route = createFileRoute("/")({
  beforeLoad: () => {
    if (typeof window === "undefined") return;
    initStore();
    const u = getCurrentUser();
    throw redirect({ to: u ? "/chats" : "/auth/login" });
  },
  component: () => null,
});
