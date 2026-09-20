import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { signUp, signInWithOAuth } from "@/api/authApi";
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

export const Route = createFileRoute("/auth/signup")({
  component: SignupPage,
  head: () => ({ meta: [{ title: "Create account — boochat" }] }),
});

function SignupPage() {
  const nav = useNavigate();
  const me = useAuth();
  const [displayName, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [partnerContext, setPartnerContext] = useState<{ partner: string; token: string } | null>(null);

  const invite = typeof window !== "undefined"
    ? new URLSearchParams(window.location.search).get("invite")
    : null;

  useEffect(() => {
    const ctx = getPartnerContext();
    setPartnerContext(ctx);
  }, []);

  useEffect(() => {
    if (me) {
      nav({ to: invite ? "/join/$inviteCode" : "/chats", params: invite ? { inviteCode: invite } : undefined });
    }
  }, [me, nav, invite]);

  const handlePartnerAuth = async () => {
    if (!partnerContext) return;
    setBusy(true);
    try {
      const apiUrl = process.env.VITE_API_URL || window.location.origin;
      const response = await fetch(`${apiUrl}/api/partner/auth`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          partner: partnerContext.partner,
          token: partnerContext.token,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        toast.error(error.error || "Partner sign-in failed");
        setBusy(false);
        return;
      }

      const { accessToken, refreshToken, redirectTo } = await response.json();

      // Set Supabase session
      const client = ensureSupabase();
      if (client && accessToken && refreshToken) {
        await client.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        toast.success("Welcome!");
        nav({ to: redirectTo });
      }
    } catch (e: any) {
      toast.error(e.message || "Partner sign-in failed");
      setBusy(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) return toast.error("Password must be at least 6 characters");
    if (password !== confirm) return toast.error("Passwords don't match");
    setBusy(true);
    try {
      const user = await signUp({ email, password, displayName });
      if (!user.id) {
        toast.success("Account created. Check your email to confirm your account.");
      } else {
        toast.success("Account created!");
        nav({ to: invite ? "/join/$inviteCode" : "/chats", params: invite ? { inviteCode: invite } : undefined });
      }
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

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-gradient-to-br from-primary/5 via-background to-background p-4">
      <Card className="w-full max-w-md p-8">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-primary text-primary-foreground text-xl font-bold">M</div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {partnerContext ? "Join via Partner" : "Create your account"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {partnerContext ? "Quick sign-in" : "Join boochat in seconds"}
          </p>
        </div>

        {partnerContext ? (
          <>
            <Button
              onClick={handlePartnerAuth}
              disabled={busy}
              className="w-full"
            >
              {busy ? "Signing in…" : `Continue with ${partnerContext.partner}`}
            </Button>
            <div className="my-4 flex items-center gap-2 text-xs text-muted-foreground">
              <div className="h-px flex-1 bg-border" /> or <div className="h-px flex-1 bg-border" />
            </div>
          </>
        ) : null}

        {!partnerContext && (
          <form onSubmit={submit} className="space-y-4">
            <div>
              <Label htmlFor="name">Display name</Label>
              <Input id="name" value={displayName} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div>
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
            </div>
            <div>
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required />
            </div>
            <div>
              <Label htmlFor="confirm">Confirm password</Label>
              <Input id="confirm" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>{busy ? "Creating…" : "Create account"}</Button>
          </form>
        )}

        {!partnerContext && (
          <>
            <div className="my-6 flex items-center gap-2 text-xs text-muted-foreground">
              <div className="h-px flex-1 bg-border" /> or <div className="h-px flex-1 bg-border" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              {isFlashGainSource ? (
                <Button
                  variant="outline"
                  onClick={handleMoneyMate}
                  disabled={busy}
                  className="col-span-2"
                >
                  {busy ? "Signing in…" : "Continue with MoneyMate"}
                </Button>
              ) : (
                [
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
                ))
              )}
            </div>
          </>
        )}

        <p className="mt-6 text-center text-sm text-muted-foreground">
          {partnerContext ? (
            <>
              Need help? <Link to="/auth/login" className="font-medium text-primary hover:underline">Sign in another way</Link>
            </>
          ) : (
            <>
              Already have an account? <Link to="/auth/login" className="font-medium text-primary hover:underline">Sign in</Link>
            </>
          )}
        </p>
      </Card>
    </div>
  );
}