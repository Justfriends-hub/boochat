import { supabase } from "@/lib/supabaseClient";
import { publish, subscribe } from "@/lib/eventBus";
import type { User } from "@/lib/mockStore";

let cachedUser: User | null = null;
let authReady = false;
let initializePromise: Promise<void> | null = null;

function toUser(profile: any, roles: Array<{ role: string }> | null = null): User {
  return {
    id: profile.id,
    email: profile.email,
    displayName: profile.display_name || profile.email.split("@")[0],
    avatar: profile.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(profile.email)}`,
    role: roles?.[0]?.role === "admin" ? "admin" : "user",
    online: profile.online ?? false,
    banned: profile.banned ?? false,
    bio: profile.bio ?? undefined,
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
    const { data: sessionData } = await supabase.auth.getSession();
    if (sessionData.session?.user?.id) {
      await refreshCurrentUser(sessionData.session.user.id);
    } else {
      cachedUser = null;
      authReady = true;
      publishAuthChange();
    }

    supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session?.user?.id) {
        await refreshCurrentUser(session.user.id);
      } else {
        cachedUser = null;
        publishAuthChange();
      }
    });
  })();
  return initializePromise;
}

async function refreshCurrentUser(userId: string) {
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id,email,display_name,avatar_url,bio,online,banned")
    .eq("id", userId)
    .single();

  if (profileError || !profile) {
    cachedUser = null;
    publishAuthChange();
    return;
  }

  const { data: roles, error: rolesError } = await supabase
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
}

export async function signIn(email: string, password: string): Promise<User> {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.session) {
    throw new Error(error?.message || "Unable to sign in.");
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
  const { data, error } = await supabase.auth.signUp({
    email: input.email,
    password: input.password,
    options: {
      data: {
        display_name: input.displayName,
      },
    },
  });

  if (error) {
    throw new Error(error.message);
  }

  if (data.session?.user?.id) {
    await refreshCurrentUser(data.session.user.id);
    if (!cachedUser) throw new Error("Unable to load user profile.");
    return cachedUser;
  }

  // If sign-up requires email confirmation, return a minimal user object until auth completes.
  return {
    id: "",
    email: input.email,
    displayName: input.displayName,
    avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(input.email)}`,
    role: "user",
    online: false,
  };
}

export async function signOut() {
  await supabase.auth.signOut();
  cachedUser = null;
  publishAuthChange();
}

export function getCurrentUser(): User | null {
  return cachedUser;
}

export function getAuthReady(): boolean {
  return authReady;
}
