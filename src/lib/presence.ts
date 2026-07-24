import { ensureSupabase } from "@/lib/supabaseClient";

export type ProfileUpdateHandler = (newProfile: any) => void;

export async function startPresence(userId: string | null, onProfileUpdate?: ProfileUpdateHandler) {
  let activeChannel: any = null;
  let activeSessionId: string | null = null;
  let cleanup = () => {};

  async function setProfileOnlineStatus(userIdInner: string | null, online: boolean) {
    if (!userIdInner) return;
    try {
      const client = ensureSupabase();
      await client.from("profiles").update({ online }).eq("id", userIdInner);
    } catch {
      // best-effort only
    }
  }

  if (!userId) {
    // no-op but return a cleanup
    await setProfileOnlineStatus(null, false);
    return () => {};
  }

  let presenceTrackSupported = false;

  try {
    const client = ensureSupabase();
    const sessionId = typeof crypto !== "undefined" && (crypto as any).randomUUID ? (crypto as any).randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const channel = client.channel(`presence:profiles`);

    channel.on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "profiles", filter: `id=eq.${userId}` },
      (payload: any) => {
        try {
          const newProfile = payload.new as any;
          if (onProfileUpdate) onProfileUpdate(newProfile);
        } catch {}
      },
    );

    await channel.subscribe();

    presenceTrackSupported = typeof channel.track === "function";
    try {
      if (presenceTrackSupported) {
        void channel.track({ user_id: userId, session_id: sessionId, online: true, last_active: new Date().toISOString() });
        activeSessionId = sessionId;
      } else {
        void setProfileOnlineStatus(userId, true);
      }
    } catch {
      if (!presenceTrackSupported) {
        void setProfileOnlineStatus(userId, true);
      }
    }

    activeChannel = channel;

    if (typeof window !== "undefined") {
      const handleVisibility = () => {
        try {
          if (!activeChannel) return;
          if (document.visibilityState === "hidden") {
            if (typeof activeChannel.track === "function") {
              void activeChannel.track({ user_id: userId, session_id: sessionId, online: false, last_active: new Date().toISOString() });
            }
          } else {
            if (typeof activeChannel.track === "function") {
              void activeChannel.track({ user_id: userId, session_id: sessionId, online: true, last_active: new Date().toISOString() });
            }
          }
        } catch {}
      };

      const handleBeforeUnload = () => {
        try {
          if (activeChannel && typeof activeChannel.untrack === "function" && activeSessionId) {
            void activeChannel.untrack({ session_id: activeSessionId });
          }
        } catch {}
      };

      window.addEventListener("visibilitychange", handleVisibility);
      window.addEventListener("beforeunload", handleBeforeUnload);

      cleanup = () => {
        try {
          window.removeEventListener("visibilitychange", handleVisibility);
          window.removeEventListener("beforeunload", handleBeforeUnload);
        } catch {}

        try {
          if (activeChannel) {
            if (activeSessionId && typeof activeChannel.untrack === "function") {
              void activeChannel.untrack({ session_id: activeSessionId });
            }
            activeChannel.unsubscribe();
          }
        } catch {}
      };
    }
  } catch {
    cleanup = () => {};
  }

  return cleanup;
}

export async function stopPresence(cleanupFn?: () => void) {
  try {
    if (cleanupFn) cleanupFn();
  } catch {}
}
