import { Link, useRouterState } from "@tanstack/react-router";
import { MessageCircle, Circle, Radio, Users, Phone, Settings, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { normalizeRole } from "@/lib/mockStore";

const items = [
  { to: "/chats", label: "Chats", icon: MessageCircle },
  { to: "/status", label: "Status", icon: Circle },
  { to: "/channels", label: "Channels", icon: Radio },
  { to: "/groups", label: "Groups", icon: Users },
  { to: "/calls", label: "Calls", icon: Phone },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

export function AppNav() {
  const user = useAuth();
  const pathname = useRouterState({ select: (s) => s.location?.pathname });
  const nav = [...items];
  if (normalizeRole(user?.role) === "owner") nav.push({ to: "/admin", label: "Admin", icon: ShieldCheck } as any);

  const isDetailRoute = typeof pathname === "string" && (
    (pathname.startsWith("/chats/") && pathname !== "/chats") ||
    (pathname.startsWith("/channels/") && pathname !== "/channels") ||
    (pathname.startsWith("/groups/") && pathname !== "/groups")
  );

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden md:flex md:w-64 md:shrink-0 md:flex-col md:border-r md:bg-card" aria-label="Primary">
        <div className="flex h-16 items-center gap-2 px-6">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground font-bold" aria-hidden="true">
            M
          </div>
          <span className="text-lg font-semibold tracking-tight">Boochat</span>
        </div>
        <nav className="flex-1 space-y-1 px-3 py-4" aria-label="Sections">
          {nav.map((it) => {
            const active = pathname === it.to || (typeof pathname === "string" && pathname.startsWith(it.to + "/"));
            return (
              <Link
                key={it.to}
                to={it.to}
                aria-label={it.label}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                  active
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <it.icon className="h-5 w-5" aria-hidden="true" />
                {it.label}
              </Link>
            );
          })}
        </nav>
      </aside>

      {/* Mobile bottom bar - hidden on detail pages */}
      {!isDetailRoute && (
        <nav
          aria-label="Primary"
          className="fixed inset-x-0 bottom-0 z-30 flex justify-around border-t bg-background/95 backdrop-blur md:hidden"
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        >
          {nav.map((it) => {
            const active = pathname === it.to || (typeof pathname === "string" && pathname.startsWith(it.to + "/"));
            return (
              <Link
                key={it.to}
                to={it.to}
                aria-label={it.label}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium transition-colors min-h-11 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  active ? "text-primary" : "text-muted-foreground",
                )}
              >
                <it.icon className={cn("h-5 w-5", active && "scale-110 transition-transform")} aria-hidden="true" />
                {it.label}
              </Link>
            );
          })}
        </nav>
      )}
    </>
  );
}
