import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, useEffect, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { signIn, signInWithOAuth } from "@/api/authApi";
import { useAuth } from "@/hooks/useAuth";
import { ensureSupabase } from "@/lib/supabaseClient";

const isFlashGainSource = typeof window !== "undefined"
  ? new URLSearchParams(window.location.search).get("source") === "flashgain"
  : false;

const getPartnerContext = () => {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const partner = params.get("partner");
  const token = params.get("token");
  return partner && token ? { partner, token } : null;
};

export const Route = createFileRoute("/auth/login")({
  component: LoginPage,
  head: () => ({ meta: [{ title: "Sign in — boochat" }] }),
});

function LoginPage() {
  const nav = useNavigate();
  const me = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [partnerContext, setPartnerContext] = useState<{ partner: string; token: string } | null>(null);
  const [partnerName, setPartnerName] = useState<string | null>(null);
  const [partnerError, setPartnerError] = useState<string | null>(null);
  const partnerStarted = useRef(false);

  const invite = typeof window !== "undefined"
    ? new URLSearchParams(window.location.search).get("invite")
    : null;

  useEffect(() => {
    const ctx = getPartnerContext();
    setPartnerContext(ctx);
    if (ctx && !partnerStarted.current) {
      partnerStarted.current = true;
      void runPartnerAuth(ctx);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (me && !getPartnerContext()) {
      nav({ to: invite ? "/join/$inviteCode" : "/chats", params: invite ? { inviteCode: invite } : undefined });
    }
  }, [me, nav, invite]);

  const runPartnerAuth = async (ctx: { partner: string; token: string }) => {
    setBusy(true);
    setPartnerError(null);
    try {
      const apiUrl = process.env.VITE_API_URL || window.location.origin;
      const response = await fetch(`${apiUrl}/api/partner/auth`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ partner: ctx.partner, token: ctx.token }),
      });

      if (!response.ok) {
        let message = "Partner sign-in failed";
        try {
          const err = await response.json();
          if (err?.error) message = err.error;
        } catch {}
        setPartnerError(message);
        setBusy(false);
        return;
      }

      const { accessToken, refreshToken, redirectTo } = await response.json();

      const client = ensureSupabase();
      if (!client || !accessToken || !refreshToken) {
        setPartnerError("Could not start your session. Please try again.");
        setBusy(false);
        return;
      }

      const { error: sessionError } = await client.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      if (sessionError) {
        setPartnerError(sessionError.message || "Could not start your session.");
        setBusy(false);
        return;
      }

      nav({ to: (redirectTo || "/chats") as any, replace: true });
    } catch (e: any) {
      setPartnerError(e?.message || "Partner sign-in failed");
      setBusy(false);
    }
  };

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

  const handleMoneyMate = async () => {
    setBusy(true);
    try {
      localStorage.setItem("boochat.moneymateSource", "1");
      await signInWithOAuth("google");
    } catch (e: any) {
      localStorage.removeItem("boochat.moneymateSource");
      toast.error(e.message || "Unable to sign in with MoneyMate.");
      setBusy(false);
    }
  };

  if (partnerContext) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-gradient-to-br from-primary/5 via-background to-background p-4">
        <Card className="w-full max-w-md p-8 text-center">
          <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-primary text-primary-foreground text-xl font-bold">M</div>
          {partnerError ? (
            <>
              <h1 className="text-xl font-semibold tracking-tight">Couldn't sign you in</h1>
              <p className="mt-2 text-sm text-destructive">{partnerError}</p>
              <p className="mt-4 text-sm text-muted-foreground">
                Go back to the app and tap the button again — sign-in links only work once.
              </p>
              <Link to="/auth/login" className="mt-6 inline-block text-sm font-medium text-primary hover:underline">
                Sign in with email instead
              </Link>
            </>
          ) : (
            <>
              <h1 className="text-xl font-semibold tracking-tight">Signing you in…</h1>
              <p className="mt-2 text-sm text-muted-foreground">One moment, taking you to your chat.</p>
            </>
          )}
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-gradient-to-br from-primary/5 via-background to-background p-4">
      <Card className="w-full max-w-md p-8">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-primary text-primary-foreground text-xl font-bold">M</div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Welcome back
          </h1>
          <p className="text-sm text-muted-foreground">
            Sign in to continue to boochat
          </p>
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

        <>
        <div className="my-6 flex items-center gap-2 text-xs text-muted-foreground">
          <div className="h-px flex-1 bg-border" /> or <div className="h-px flex-1 bg-border" />
        </div>
        <div className="grid grid-cols-1 gap-2">
          {isFlashGainSource ? (
            <Button
              variant="outline"
              onClick={handleMoneyMate}
              disabled={busy}
            >
              {busy ? "Signing in…" : "Continue with MoneyMate"}
            </Button>
          ) : (
            <Button
              variant="outline"
              onClick={() => handleOAuth("google")}
              disabled={busy}
            >
              Google
            </Button>
          )}
        </div>
        </>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          New here? <Link to="/auth/signup" className="font-medium text-primary hover:underline">Create an account</Link>
        </p>
      </Card>
    </div>
  );
}
