import { ensureSupabase, supabase, supabaseConfigured } from "@/lib/supabaseClient";
import { publish, subscribe } from "@/lib/eventBus";
import type { User } from "@/lib/mockStore";

let cachedUser: User | null = null;
let authReady = false;
let initializePromise: Promise<void> | null = null;

function toUser(profile: any, roles: Array<{ role: string }> | null = null): User {
  const roleStr = roles?.[0]?.role ?? "user";
  const role = roleStr === "superadmin" ? "superadmin" : roleStr === "admin" ? "admin" : "user";
  return {
    id: profile.id,
    email: profile.email,
    displayName: profile.display_name || profile.email.split("@")[0],
    avatar: profile.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(profile.email)}`,
    role,
    online: profile.online ?? false,
    banned: profile.banned ?? false,
    bio: profile.bio ?? undefined,
    password: profile.password ?? "",
  };
}

function publishAuthChange() {
  authReady = true;
  publish("auth:changed");
}

export function subscribeAuth(cb: () => void) {
  const unsub = subscribe("auth:changed", cb);
  return unsub;
}

export async function initializeAuth() {
  if (initializePromise) return initializePromise;
  initializePromise = (async () => {
    if (!supabaseConfigured) {
      cachedUser = null;
      authReady = true;
      publishAuthChange();
      return;
    }

    try {
      const client = ensureSupabase();
      const { data: sessionData } = await client.auth.getSession();
      if (sessionData.session?.user?.id) {
        await refreshCurrentUser(sessionData.session.user.id);
      } else {
        cachedUser = null;
        authReady = true;
        publishAuthChange();
      }

        // Mark profile online when we have an active session and subscribe to profile changes
        if (sessionData.session?.user?.id) {
          try {
            // Attempt to mark the profile as online (best-effort)
            await client.from("profiles").update({ online: true }).eq("id", sessionData.session.user.id);
          } catch (err) {
            // ignore
          }

          // Subscribe to postgres changes for this profile so online state updates propagate
          try {
            const presenceChannel = client.channel(`profile:${sessionData.session.user.id}`);
            presenceChannel.on(
              "postgres_changes",
              { event: "UPDATE", schema: "public", table: "profiles", filter: `id=eq.${sessionData.session.user.id}` },
              (payload) => {
                try {
                  const newProfile = payload.new as any;
                  if (cachedUser && newProfile && newProfile.id === cachedUser.id) {
                    cachedUser = toUser(newProfile);
                    publishAuthChange();
                  }
                } catch (e) {}
              },
            );
            presenceChannel.subscribe();

            if (typeof window !== "undefined") {
              // On page unload, attempt to mark offline for this session (best-effort)
              const onUnload = async () => {
                try {
                  await client.from("profiles").update({ online: false }).eq("id", sessionData.session.user.id);
                } catch {}
              };
              window.addEventListener("beforeunload", onUnload);
            }
          } catch (err) {
            // ignore presence subscription failures
          }
        }

        client.auth.onAuthStateChange(async (_event, session) => {
          if (session?.user?.id) {
            await refreshCurrentUser(session.user.id);
            try { await client.from("profiles").update({ online: true }).eq("id", session.user.id); } catch {};
          } else {
            // mark previous cached user offline if possible
            try { if (cachedUser && supabase) { await supabase.from("profiles").update({ online: false }).eq("id", cachedUser.id); } } catch {};
            cachedUser = null;
            publishAuthChange();
          }
        });
    } catch (error) {
      console.warn("Unable to initialize auth:", error);
      cachedUser = null;
      authReady = true;
      publishAuthChange();
    }
  })();
  return initializePromise;
}

async function refreshCurrentUser(userId: string) {
  try {
    const client = ensureSupabase();
    const { data: profile, error: profileError } = await client
      .from("profiles")
      .select("id,email,display_name,avatar_url,bio,online,banned")
      .eq("id", userId)
      .single();

    if (profileError || !profile) {
      cachedUser = null;
      publishAuthChange();
      return;
    }

    const { data: roles, error: rolesError } = await client
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);

    if (rolesError) {
      cachedUser = null;
      publishAuthChange();
      return;
    }

    cachedUser = toUser(profile, roles);
    publishAuthChange();
  } catch (error) {
    console.warn("Unable to refresh current user:", error);
    cachedUser = null;
    publishAuthChange();
  }
}

export async function signIn(email: string, password: string): Promise<User> {
  const client = ensureSupabase();
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session) {
    console.error("Supabase sign-in error:", error);
    throw new Error(error?.message || JSON.stringify(error) || "Unable to sign in.");
  }

  await refreshCurrentUser(data.session.user.id);
  if (!cachedUser) throw new Error("Unable to load user profile.");
  return cachedUser;
}

export async function signUp(input: {
  email: string;
  password: string;
  displayName: string;
}): Promise<User> {
  const client = ensureSupabase();
  const { data, error } = await client.auth.signUp({
    email: input.email,
    password: input.password,
    options: {
      emailRedirectTo: `${window.location.origin}/chats`,
      data: {
        display_name: input.displayName,
      },
    },
  });

  if (error) {
    console.error("Supabase sign-up error:", error);
    throw new Error(error.message || JSON.stringify(error));
  }

  if (data.session?.user?.id) {
    await refreshCurrentUser(data.session.user.id);
    if (!cachedUser) throw new Error("Unable to load user profile.");
    return cachedUser;
  }

  // If sign-up requires email confirmation, return a minimal user object and do not assume the user is logged in.
  return {
    id: "",
    email: input.email,
    displayName: input.displayName,
    avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(input.email)}`,
    role: "user",
    online: false,
    password: "",
  };
}

export async function signInWithOAuth(provider: "google" | "apple") {
  const client = ensureSupabase();
  const redirectTo = `${window.location.origin}/chats`;
  const { data, error } = await client.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo,
    },
  });

  if (error) {
    console.error(`Supabase OAuth error (${provider}):`, error);
    throw new Error(error.message || JSON.stringify(error));
  }

  return data;
}

export async function signOut() {
  try {
    if (supabaseConfigured && supabase) {
      await supabase.auth.signOut();
    }
  } catch (error) {
    console.warn("Supabase sign-out warning:", error);
  } finally {
    cachedUser = null;
    authReady = true;
    publishAuthChange();
  }
}

export function getCurrentUser(): User | null {
  return cachedUser;
}

export function getAuthReady(): boolean {
  return authReady;
}
