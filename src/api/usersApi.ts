import { ensureSupabase } from "@/lib/supabaseClient";
import { publish } from "@/lib/eventBus";
import { getState, setState, type User } from "@/lib/mockStore";
import { getImageUrl } from "@/lib/imageUpload";

/**
 * Resolves an avatar_url from the profiles table to a usable image URL.
 * - Full https:// URLs → returned as-is (DiceBear, external CDN, etc.)
 * - Storage paths (e.g. "userId/123.webp") → resolved via the avatars bucket
 * - Empty/null → DiceBear fallback
 */
async function resolveAvatarUrl(avatarUrl: string | null | undefined, email: string): Promise<string> {
  const fallback = `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(email)}`;
  if (!avatarUrl) return fallback;
  if (/^https?:\/\//i.test(avatarUrl)) return avatarUrl; // already a full URL
  try {
    return await getImageUrl("avatars", avatarUrl);
  } catch {
    return fallback;
  }
}

function mapProfileSync(profile: any): User {
  // For synchronous mapping, pass through avatar_url as-is.
  // Callers that need a resolved URL should use mapProfileAsync.
  const rawAvatar = profile.avatar_url || "";
  const avatar = /^https?:\/\//i.test(rawAvatar)
    ? rawAvatar  // already a full URL — use it directly
    : rawAvatar
      ? undefined // storage path — will be resolved asynchronously
      : `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(profile.email)}`;

  return {
    id: profile.id,
    email: profile.email,
    password: "",
    displayName: profile.display_name || profile.email?.split("@")[0] || "User",
    avatar: avatar ?? `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(profile.email)}`,
    role: profile.role ?? "user",
    online: profile.online ?? false,
    banned: profile.banned ?? false,
    bio: profile.bio ?? undefined,
  };
}

async function mapProfileAsync(profile: any): Promise<User> {
  const base = mapProfileSync(profile);
  // If avatar was a storage path, resolve it now
  if (!base.avatar || !/^https?:\/\//i.test(base.avatar)) {
    base.avatar = await resolveAvatarUrl(profile.avatar_url, profile.email);
  }
  return base;
}

export async function listUsers(): Promise<User[]> {
  try {
    const supabase = ensureSupabase();
    const { data, error } = await supabase
      .from("profiles")
      .select("id,email,display_name,avatar_url,bio,online,banned,role")
      .order("display_name", { ascending: true });

    if (!error && data) {
      // First pass: sync map so the UI has names/DiceBear avatars immediately
      const syncUsers = data.map(mapProfileSync);
      setState((s) => { s.users = syncUsers; });

      // Second pass: resolve any storage-path avatars asynchronously
      Promise.all(data.map(mapProfileAsync)).then((resolved) => {
        setState((s) => { s.users = resolved; });
        publish("users:changed");
      }).catch(() => {});

      return syncUsers;
    }
  } catch (err) {
    console.warn("Offline or network error fetching users, returning cached users:", err);
  }
  return getState().users;
}

export async function getUser(id: string): Promise<User | undefined> {
  // Check cache first for instant response
  const cached = getState().users.find((u) => u.id === id);
  if (cached && /^https?:\/\//i.test(cached.avatar || "")) return cached;

  try {
    const supabase = ensureSupabase();
    const { data, error } = await supabase
      .from("profiles")
      .select("id,email,display_name,avatar_url,bio,online,banned,role")
      .eq("id", id)
      .single();

    if (!error && data) {
      const user = await mapProfileAsync(data);
      setState((s) => {
        const idx = s.users.findIndex((u) => u.id === id);
        if (idx >= 0) s.users[idx] = user;
        else s.users.push(user);
      });
      return user;
    }
  } catch (err) {
    console.warn("Offline or network error fetching user, returning cached user:", err);
  }
  return getState().users.find((u) => u.id === id);
}

export async function updateUser(id: string, patch: Partial<User>) {
  const supabase = ensureSupabase();
  const update: Record<string, any> = {};
  if (patch.displayName !== undefined) update.display_name = patch.displayName;
  if (patch.avatar !== undefined) update.avatar_url = patch.avatar;
  if (patch.bio !== undefined) update.bio = patch.bio;
  if (patch.online !== undefined) update.online = patch.online;
  if (patch.banned !== undefined) update.banned = patch.banned;

  const { error } = await supabase.from("profiles").update(update).eq("id", id);
  if (error) throw new Error(error.message);
  publish("users:changed");
}
