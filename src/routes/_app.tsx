import { createFileRoute, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { AppNav } from "@/components/AppNav";
import { PullToRefresh } from "@/components/PullToRefresh";
import { useAuth, useAuthReady } from "@/hooks/useAuth";
import { useAppHeight } from "@/hooks/useVisualViewport";
import { initStore, getState } from "@/lib/mockStore";
import { FeatureBoundary } from "@/components/FeatureBoundary";
import { cn } from "@/lib/utils";
import { listChats } from "@/api/chatsApi";
import { listChannels } from "@/api/channelsApi";
import { listUsers } from "@/api/usersApi";
import { ensureSupabase } from "@/lib/supabaseClient";

export const Route = createFileRoute("/_app")({
  component: AppLayout,
});

function AppLayout() {
  const me = useAuth();
  const ready = useAuthReady();
  const nav = useNavigate();
  const qc = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location?.pathname });
  const isLoading = useRouterState({ select: (s) => s.status === "pending" || s.isLoading });
  const appHeight = useAppHeight();
  const [moneyMateJoined, setMoneyMateJoined] = useState(false);

  const isDetailRoute = typeof pathname === "string" && (
    (pathname.startsWith("/chats/") && pathname !== "/chats") ||
    (pathname.startsWith("/channels/") && pathname !== "/channels") ||
    (pathname.startsWith("/groups/") && pathname !== "/groups")
  );

  // initStore purges any retired demo placeholders; new users start empty
  // and only see chats/channels the server says they belong to.
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
    const isAuthRoute = window.location.pathname.startsWith("/auth/");
    if (!me && !isAuthRoute) nav({ to: "/auth/login", replace: true });
  }, [me, ready, nav]);

  // Auto-join the "moneymate" channel when a user arrives via a MoneyMate
  // tracking link (source=flashgain). The auth pages set a localStorage flag
  // before triggering OAuth because the URL param is lost during the redirect.
  // This lives in the persistent _app layout so it survives the OAuth round-trip.
  useEffect(() => {
    if (!ready || !me || typeof window === "undefined") return;
    const isMoneyMateSource = localStorage.getItem("boochat.moneymateSource") === "1";
    if (!isMoneyMateSource) return;
    if (moneyMateJoined) return;

    let cancelled = false;
    (async () => {
      try {
        localStorage.removeItem("boochat.moneymateSource");
        const client = ensureSupabase();
        if (!client) return;

        const { data: channel, error: chError } = await client
          .from("channels")
          .select("id, name")
          .eq("name", "moneymate")
          .single();

        if (chError && chError.code !== "PGRST116") {
          console.warn("MoneyMate auto-join: error fetching channel:", chError);
          return;
        }

        if (channel?.id) {
          const { data: members, error: memError } = await client
            .from("channel_members")
            .select("user_id")
            .eq("channel_id", channel.id)
            .eq("user_id", me.id);

          if (memError) {
            console.warn("MoneyMate auto-join: error checking membership:", memError);
            return;
          }

          if (!members?.length) {
            await client.from("channel_members").insert({
              channel_id: channel.id,
              user_id: me.id,
            });
          }
        } else {
          const { data: newChannel, error: createError } = await client
            .from("channels")
            .insert({
              name: "moneymate",
              visibility: "public",
              owner_id: me.id,
            })
            .select()
            .single();

          if (createError) {
            console.warn("MoneyMate auto-join: error creating channel:", createError);
            return;
          }

          await client.from("channel_members").insert({
            channel_id: newChannel.id,
            user_id: me.id,
            is_admin: true,
          });
        }

        if (!cancelled) {
          setMoneyMateJoined(true);
          void qc.invalidateQueries({ queryKey: ["channels"] });
        }
      } catch (err) {
        console.warn("MoneyMate auto-join failed:", err);
      }
    })();

    return () => { cancelled = true; };
  }, [me, ready, moneyMateJoined, qc]);

  useEffect(() => {
    if (!ready || !me || typeof window === "undefined") return;
    void Promise.allSettled([
      qc.prefetchQuery({ queryKey: ["users"], queryFn: listUsers, staleTime: 30_000 }),
      qc.prefetchQuery({ queryKey: ["chats", me.id], queryFn: () => listChats(me.id), staleTime: 15_000 }),
      qc.prefetchQuery({ queryKey: ["channels", me.id], queryFn: () => listChannels(me.id), staleTime: 15_000 }),
    ]);
  }, [me, qc, ready]);

  if (!ready || !me) {
    return (
      <div className="flex items-center justify-center bg-background p-4" style={{ height: `${appHeight || 0}px` }}>
        <div className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    );
  }

  return (
    <div className="relative flex w-full overflow-hidden bg-background text-foreground" style={{ height: `${appHeight || 0}px` }}>
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

