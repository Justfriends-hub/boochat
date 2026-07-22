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
    <div className="flex h-dvh w-full overflow-hidden bg-background text-foreground">
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

