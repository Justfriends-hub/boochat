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

  // initStore still ensures seeding; the store is loaded synchronously at module
  // initialization so we can render a cached snapshot immediately.
  useEffect(() => { initStore(); }, []);
  useEffect(() => {
    if (!ready || typeof window === "undefined") return;
    if (!me) nav({ to: "/auth/login" });
  }, [me, ready, nav]);

  if (!ready || !me) {
    // Show a lightweight cached snapshot from the persisted mock store to
    // improve perceived load time instead of a blank spinner.
    const s = getState();
    return (
      <div className="flex h-dvh items-center justify-center bg-background p-4">
        <div className="w-full max-w-2xl space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold">BooChat</h2>
              <p className="text-sm text-muted-foreground">Loading… showing last saved view</p>
            </div>
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>

          <div className="rounded-lg border bg-card p-4">
            <h3 className="text-sm font-semibold">Recent Chats</h3>
            <ul className="mt-2 space-y-2">
              {s.chats.slice(0, 5).map((c) => (
                <li key={c.id} className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-full bg-muted" />
                    <div>
                      <div className="text-sm font-medium">{c.name || c.id}</div>
                      <div className="text-xs text-muted-foreground">{c.memberIds.length} members</div>
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground">{new Date(c.createdAt).toLocaleDateString()}</div>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-lg border bg-card p-4">
            <h3 className="text-sm font-semibold">Channels</h3>
            <ul className="mt-2 space-y-2">
              {s.channels.slice(0, 5).map((ch) => (
                <li key={ch.id} className="flex items-center justify-between">
                  <div className="text-sm">{ch.name}</div>
                  <div className="text-xs text-muted-foreground">{ch.memberIds.length}</div>
                </li>
              ))}
            </ul>
          </div>
        </div>
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

