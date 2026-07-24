import { createFileRoute, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { AppNav } from "@/components/AppNav";
import { PullToRefresh } from "@/components/PullToRefresh";
import { useAuth, useAuthReady } from "@/hooks/useAuth";
import { initStore, getState } from "@/lib/mockStore";
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

  // initStore still ensures seeding; the store is loaded synchronously at module
  // initialization so we can render a cached snapshot immediately.
  useEffect(() => { initStore(); }, []);
  // Persist last viewed pathname so cached snapshot better reflects user's last screen
  useEffect(() => {
    try {
      if (typeof window !== "undefined" && typeof pathname === "string") {
        localStorage.setItem("chatapp.lastpath.v1", pathname);
      }
    } catch {}
  }, [pathname]);
  useEffect(() => {
    if (!ready || typeof window === "undefined") return;
    if (!me) nav({ to: "/auth/login" });
  }, [me, ready, nav]);

  if (!ready || !me) {
    return (
      <div className="flex h-dvh items-center justify-center bg-background p-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-primary border-t-transparent animate-spin" />
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

