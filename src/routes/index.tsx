import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { getCurrentUser, initializeAuth } from "@/api/authApi";
import { ensureSupabase } from "@/lib/supabaseClient";
import { initStore } from "@/lib/mockStore";

export const Route = createFileRoute("/")({
  component: IndexRedirect,
});

function IndexRedirect() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    initStore();

    const restore = async () => {
      try {
        await initializeAuth();
        const client = ensureSupabase();
        const { data: sessionData } = client ? await client.auth.getSession() : { data: { session: null } };
        const user = getCurrentUser();
        const hasValidSession = Boolean(sessionData.session || user);
        setReady(true);
        if (hasValidSession) {
          navigate({ to: "/chats", replace: true });
        } else {
          navigate({ to: "/auth/login", replace: true });
        }
      } catch {
        setReady(true);
        navigate({ to: "/auth/login", replace: true });
      }
    };

    void restore();
  }, [navigate]);

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>
  );
}
