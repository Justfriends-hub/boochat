import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { getCurrentUser } from "@/api/authApi";
import { initStore } from "@/lib/mockStore";

export const Route = createFileRoute("/")({
  component: IndexRedirect,
});

function IndexRedirect() {
  const navigate = useNavigate();
  useEffect(() => {
    initStore();
    const u = getCurrentUser();
    navigate({ to: u ? "/chats" : "/auth/login", replace: true });
  }, [navigate]);
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>
  );
}
