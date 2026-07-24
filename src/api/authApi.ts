import { ensureSupabase, supabase, supabaseConfigured } from "@/lib/supabaseClient";
import { uploadImage, getImageUrl } from "@/lib/imageUpload";
import { publish, subscribe } from "@/lib/eventBus";
import { normalizeRole, type User } from "@/lib/mockStore";
import { startPresence, stopPresence } from "@/lib/presence";

let cachedUser: User | null = null;
let authReady = false;
let initializePromise: Promise<void> | null = null;
let activePresenceUserId: string | null = null;
let activePresenceCleanup: (() => void) | null = null;
let authStateSubscription: { data: { subscription: { unsubscribe: () => void } } } | null = null;

function toUser(profile: any, roles: Array<{ role: string }> | null = null): User {
  const roleStr = roles?.[0]?.role ?? profile.role ?? "user";
  const role = normalizeRole(roleStr);
  // avatar_url may be a storage path (e.g. "userId/123.jpg") or a full https:// URL.
  // getImageUrl handles both: passes through https:// links, resolves storage paths.
  const rawAvatar = profile.avatar_url || "";
  const avatar =
    rawAvatar && !/^https?:\/\//i.test(rawAvatar)
      ? undefined // resolved asynchronously below by resolveUserAvatar
      : rawAvatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(profile.email)}`;
  return {
    id: profile.id,
    email: profile.email,
    displayName: profile.display_name || profile.email.split("@")[0],
    avatar: avatar ?? `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(profile.email)}`,
    role,
    online: profile.online ?? false,
    banned: profile.banned ?? false,
    bio: profile.bio ?? undefined,
    // Carry the raw path so callers can resolve it if needed
    _avatarPath: rawAvatar && !/^https?:\/\//i.test(rawAvatar) ? rawAvatar : undefined,
  } as User & { _avatarPath?: string };
}

/** Resolves a profile row's avatar_url to a usable URL (public CDN or DiceBear fallback). */
async function resolveAvatarUrl(profile: any): Promise<string> {
  const raw: string = profile.avatar_url || "";
  if (!raw) return `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(profile.email)}`;
  try {
    return await getImageUrl("avatars", raw);
  } catch {
    return `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(profile.email)}`;
  }
}

function publishAuthChange() {
  authReady = true;
  publish("auth:changed");
}

async function setProfileOnlineStatus(userId: string | null, online: boolean) {
  if (!userId) return;
  try {
    const client = ensureSupabase();
    await client.from("profiles").update({ online }).eq("id", userId);
  } catch {
    // best-effort only
  }
}

function cleanupPresence() {
  if (activePresenceCleanup) {
    try {
      stopPresence(activePresenceCleanup);
    } catch {}
    activePresenceCleanup = null;
  }
  activePresenceUserId = null;
}

async function bindPresence(userId: string | null) {
  if (!userId) {
    if (activePresenceUserId) {
      try {
        const client = ensureSupabase();
        await client.from("profiles").update({ online: false }).eq("id", activePresenceUserId);
      } catch {}
    }
    cleanupPresence();
    return;
  }

  if (activePresenceUserId === userId && activePresenceCleanup) return;

  if (activePresenceUserId && activePresenceUserId !== userId) {
    try {
      const client = ensureSupabase();
      await client.from("profiles").update({ online: false }).eq("id", activePresenceUserId);
    } catch {}
  }

  cleanupPresence();

  try {
    // startPresence returns a cleanup function; it will call onProfileUpdate when the DB emits changes
    const cleanupFn = await startPresence(userId, (newProfile: any) => {
      try {
        if (cachedUser && newProfile && newProfile.id === cachedUser.id) {
          const nextUser = toUser(newProfile);
          cachedUser = nextUser;
          publishAuthChange();
        }
      } catch {}
    });

    activePresenceCleanup = cleanupFn;
    activePresenceUserId = userId;
  } catch {
    cleanupPresence();
  }
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

      await bindPresence(sessionData.session?.user?.id ?? null);

      if (!authStateSubscription) {
        authStateSubscription = client.auth.onAuthStateChange(async (event, session) => {
          // Only refresh profile on sign-in or user update, not on every token refresh
          const shouldRefresh = event === "SIGNED_IN" || event === "USER_UPDATED";
          if (session?.user?.id) {
            if (shouldRefresh) {
              await refreshCurrentUser(session.user.id);
            }
            await bindPresence(session.user.id);
          } else {
            await bindPresence(null);
            cachedUser = null;
            publishAuthChange();
          }
        });
      }
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

    const user = toUser(profile, roles);
    // Resolve storage-path avatars to public URLs asynchronously
    user.avatar = await resolveAvatarUrl(profile);
    cachedUser = user;
    publishAuthChange();
  } catch (error) {
    console.warn("Unable to refresh current user:", error);
    cachedUser = null;
    publishAuthChange();
  }
}

/**
 * Updates profile fields and/or the user's avatar.
 * Pass `avatarFile` to compress and upload a new profile picture.
 */
export async function updateProfile(
  userId: string,
  updates: { displayName?: string; bio?: string; avatarFile?: File },
): Promise<void> {
  const client = ensureSupabase();
  const dbUpdate: Record<string, unknown> = {};

  if (updates.displayName !== undefined) dbUpdate.display_name = updates.displayName;
  if (updates.bio !== undefined) dbUpdate.bio = updates.bio;

  if (updates.avatarFile) {
    // Compress to 256 × 256 max for avatars, then upload to the public bucket
    const path = await uploadImage(updates.avatarFile, "avatars", userId, { maxDim: 256 });
    dbUpdate.avatar_url = path;
  }

  if (Object.keys(dbUpdate).length === 0) return;

  const { error } = await client.from("profiles").update(dbUpdate).eq("id", userId);
  if (error) throw new Error(error.message);

  // Refresh in-memory user so the UI updates immediately
  await refreshCurrentUser(userId);
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
    await bindPresence(null);
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
