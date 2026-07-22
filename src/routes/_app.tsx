import { createFileRoute, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { AppNav } from "@/components/AppNav";
import { PullToRefresh } from "@/components/PullToRefresh";
import { useAuth, useAuthReady } from "@/hooks/useAuth";
import { initStore } from "@/lib/mockStore";
import { FeatureBoundary } from "@/components/FeatureBoundary";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app")({
  component: AppLayout,
});

function AppLayout() {
  const me = useAuth();
  const ready = useAuthReady();
  const nav = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location?.pathname });
  const isLoading = useRouterState({ select: (s) => s.status === "pending" || s.isLoading });

  const isDetailRoute = typeof pathname === "string" && (
    (pathname.startsWith("/chats/") && pathname !== "/chats") ||
    (pathname.startsWith("/channels/") && pathname !== "/channels") ||
    (pathname.startsWith("/groups/") && pathname !== "/groups")
  );

  useEffect(() => { initStore(); }, []);
  useEffect(() => {
    if (!ready || typeof window === "undefined") return;
    if (!me) nav({ to: "/auth/login" });
  }, [me, ready, nav]);

  if (!ready || !me) {
    return (
      <div className="flex h-dvh items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="relative flex h-dvh w-full overflow-hidden bg-background text-foreground">
      {isLoading && (
        <div className="absolute top-0 left-0 right-0 z-50 h-1 bg-primary/20 overflow-hidden">
          <div className="h-full bg-primary animate-pulse w-full" />
        </div>
      )}
      <AppNav />
      <main className={cn("flex flex-1 flex-col overflow-hidden h-full min-h-0", isDetailRoute ? "pb-0" : "pb-14 md:pb-0")}>
        <FeatureBoundary name="page">
          <PullToRefresh>
            <Outlet />
          </PullToRefresh>
        </FeatureBoundary>
      </main>
    </div>
  );
}

