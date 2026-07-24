import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
  useRouterState,
} from "@tanstack/react-router";
import { useEffect, useRef, type ReactNode } from "react";
import { Toaster } from "@/components/ui/sonner";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { initStore } from "@/lib/mockStore";
import { useTheme } from "@/hooks/useTheme";
import { OfflineBanner } from "@/components/OfflineBanner";
import { InstallPromptBanner } from "@/components/InstallPromptBanner";
import { initOfflineStore, getAppState, setAppState } from "@/lib/offlineStore";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold">404</h1>
        <p className="mt-2 text-sm text-muted-foreground">This page doesn't exist.</p>
        <a href="/" className="mt-6 inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
          Go home
        </a>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error("Root route error:", error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);
  return (
    <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent mb-3" />
      <p className="text-sm font-medium text-muted-foreground">Loading page...</p>
      <button
        onClick={() => { router.invalidate(); reset(); }}
        className="mt-4 text-xs text-primary underline"
      >
        Retry now
      </button>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover, interactive-widget=resizes-content" },
      { title: "Meshly — Chat, together" },
      { name: "description", content: "A fast, private messenger for chats, groups, channels, and stories." },
      { name: "theme-color", content: "#0f172a" },
      { property: "og:title", content: "Meshly — Chat, together" },
      { property: "og:description", content: "A fast, private messenger for chats, groups, channels, and stories." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Meshly — Chat, together" },
      { name: "twitter:description", content: "A fast, private messenger for chats, groups, channels, and stories." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/ab8ea408-39ab-406c-baaa-57f42c948182/id-preview-ae912ff8--3547b0b9-267c-4862-8ad5-3ca605f9a8d5.lovable.app-1784595058795.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/ab8ea408-39ab-406c-baaa-57f42c948182/id-preview-ae912ff8--3547b0b9-267c-4862-8ad5-3ca605f9a8d5.lovable.app-1784595058795.png" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/icons/icon-192.png" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

/** Saves the current pathname to IndexedDB whenever it changes. */
function RouteTracker() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const router = useRouter();
  const didRestoreRef = useRef(false);

  // On first mount: restore last visited route (offline-first "return to where you left off")
  useEffect(() => {
    if (didRestoreRef.current) return;
    didRestoreRef.current = true;

    getAppState<string>("lastRoute").then((saved) => {
      if (!saved) return;
      // Only restore deep routes (chat/group pages), not auth pages
      const isRestorable =
        saved.startsWith("/chats/") ||
        saved.startsWith("/groups/") ||
        saved.startsWith("/channels/");
      if (!isRestorable) return;
      // Only navigate if the current location is still the root/index
      if (window.location.pathname === "/" || window.location.pathname === "") {
        router.navigate({ to: saved, replace: true }).catch(() => {});
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist current route on every navigation (debounced 500 ms)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      setAppState("lastRoute", pathname).catch(() => {});
    }, 500);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [pathname]);

  return null;
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  useTheme(); // initialize theme class

  // Initialize mock store + offline IndexedDB cache
  useEffect(() => {
    initStore();
    initOfflineStore().catch(console.warn);
  }, []);

  // Register service worker (production only, never in preview/iframe/dev)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const host = window.location.hostname;
    const inIframe = window.self !== window.top;
    const isPreview =
      host.startsWith("id-preview--") || host.startsWith("preview--") ||
      host.endsWith(".lovableproject.com") || host.endsWith(".lovableproject-dev.com") ||
      host.endsWith(".beta.lovable.dev") ||
      host === "localhost" || host === "127.0.0.1";
    if (!("serviceWorker" in navigator)) return;
    if (inIframe || isPreview || !import.meta.env.PROD) {
      navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister()));
      return;
    }
    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => {
        // When a new SW is waiting, activate it immediately
        if (reg.waiting) reg.waiting.postMessage({ type: "SKIP_WAITING" });
        reg.addEventListener("updatefound", () => {
          const newWorker = reg.installing;
          if (!newWorker) return;
          newWorker.addEventListener("statechange", () => {
            if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
              newWorker.postMessage({ type: "SKIP_WAITING" });
            }
          });
        });
      })
      .catch(() => {});
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <OfflineBanner />
      <InstallPromptBanner />
      <RouteTracker />
      <Outlet />
      <Toaster richColors position="top-center" />
    </QueryClientProvider>
  );
}
