import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { UserAvatar } from "@/components/UserAvatar";
import { ThemeToggle } from "@/components/ThemeToggle";
import { InstallButton } from "@/components/InstallButton";
import { useAuth } from "@/hooks/useAuth";
import { signOut } from "@/api/authApi";
import { LogOut, ShieldCheck } from "lucide-react";

export const Route = createFileRoute("/_app/settings")({
  component: SettingsPage,
  head: () => ({ meta: [{ title: "Settings — Meshly" }] }),
});

function SettingsPage() {
  const me = useAuth();
  const nav = useNavigate();

  if (!me) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <header className="flex h-16 items-center justify-between border-b bg-card px-4">
        <h1 className="text-xl font-semibold">Settings</h1>
        <ThemeToggle />
      </header>
      <div className="flex-1 overflow-y-auto p-4 space-y-4 max-w-2xl w-full mx-auto">
        <Card className="p-4 flex items-center gap-3">
          <UserAvatar name={me.displayName} src={me.avatar} size={64} online />
          <div>
            <p className="text-lg font-semibold">{me.displayName}</p>
            <p className="text-sm text-muted-foreground">{me.email}</p>
            <p className="mt-1 text-xs uppercase tracking-wide text-primary">{me.role}</p>
          </div>
        </Card>

        <Card className="p-4 space-y-3">
          <Label className="text-xs uppercase text-muted-foreground">Appearance</Label>
          <div className="flex items-center justify-between">
            <p className="text-sm">Theme</p>
            <ThemeToggle />
          </div>
        </Card>

        <Card className="p-4 space-y-3">
          <Label className="text-xs uppercase text-muted-foreground">App</Label>
          <InstallButton />
        </Card>

        {me.role === "admin" && (
          <Card className="p-4">
            <Button variant="outline" className="w-full" onClick={() => nav({ to: "/admin" })}>
              <ShieldCheck className="mr-2 h-4 w-4" /> Open Admin Panel
            </Button>
          </Card>
        )}

        <Button
          variant="destructive" className="w-full"
          onClick={async () => { await signOut(); nav({ to: "/auth/login" }); }}
        >
          <LogOut className="mr-2 h-4 w-4" /> Sign out
        </Button>
      </div>
    </div>
  );
}
