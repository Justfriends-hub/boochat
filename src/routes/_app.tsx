import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { AppNav } from "@/components/AppNav";
import { useAuth } from "@/hooks/useAuth";
import { initStore } from "@/lib/mockStore";
import { FeatureBoundary } from "@/components/FeatureBoundary";

export const Route = createFileRoute("/_app")({
  component: AppLayout,
});

function AppLayout() {
  const me = useAuth();
  const nav = useNavigate();
  useEffect(() => { initStore(); }, []);
  useEffect(() => {
    if (typeof window === "undefined") return;
    // Wait one tick for hydration; if still no user, redirect.
    const t = setTimeout(() => {
      if (!me) nav({ to: "/auth/login" });
    }, 30);
    return () => clearTimeout(t);
  }, [me, nav]);

  if (!me) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="flex bg-background text-foreground" style={{ minHeight: "100dvh" }}>
      <AppNav />
      <main className="flex flex-1 flex-col pb-14 md:pb-0 overflow-hidden" style={{ minHeight: "100dvh" }}>
        <FeatureBoundary name="page">
          <Outlet />
        </FeatureBoundary>
      </main>
    </div>
  );
}
