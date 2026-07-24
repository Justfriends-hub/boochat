import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { signIn, signInWithOAuth } from "@/api/authApi";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/auth/login")({
  component: LoginPage,
  head: () => ({ meta: [{ title: "Sign in — Boochat" }] }),
});

function LoginPage() {
  const nav = useNavigate();
  const me = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const invite = typeof window !== "undefined"
    ? new URLSearchParams(window.location.search).get("invite")
    : null;

  useEffect(() => {
    if (me) {
      nav({ to: invite ? "/join/$inviteCode" : "/chats", params: invite ? { inviteCode: invite } : undefined });
    }
  }, [me, nav, invite]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await signIn(email, password);
      toast.success("Welcome back!");
      nav({ to: invite ? "/join/$inviteCode" : "/chats", params: invite ? { inviteCode: invite } : undefined });
    } catch (e: any) {
      toast.error(e.message);
    } finally { setBusy(false); }
  };

  const handleOAuth = async (provider: "google" | "apple") => {
    setBusy(true);
    try {
      await signInWithOAuth(provider);
    } catch (e: any) {
      toast.error(e.message || `Unable to sign in with ${provider}.`);
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-gradient-to-br from-primary/5 via-background to-background p-4">
      <Card className="w-full max-w-md p-8">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-primary text-primary-foreground text-xl font-bold">M</div>
          <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
          <p className="text-sm text-muted-foreground">Sign in to continue to Boochat</p>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
          </div>
          <div>
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          </div>
          <Button type="submit" className="w-full" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</Button>
        </form>
        <div className="my-6 flex items-center gap-2 text-xs text-muted-foreground">
          <div className="h-px flex-1 bg-border" /> or <div className="h-px flex-1 bg-border" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          {[
            { label: "Google", provider: "google" as const },
            { label: "Apple", provider: "apple" as const },
          ].map((p) => (
            <Button
              key={p.label}
              variant="outline"
              onClick={() => handleOAuth(p.provider)}
              disabled={busy}
            >
              {p.label}
            </Button>
          ))}
        </div>
        <p className="mt-6 text-center text-sm text-muted-foreground">
          New here? <Link to="/auth/signup" className="font-medium text-primary hover:underline">Create an account</Link>
        </p>
      </Card>
    </div>
  );
}
