import { ensureSupabase } from "@/lib/supabaseClient";
import { publish } from "@/lib/eventBus";
import { getState, setState, normalizeRole, type User } from "@/lib/mockStore";
import { getImageUrl, batchGetImageUrls } from "@/lib/imageUpload";

/**
 * Batch-resolves storage-path avatars to signed URLs using the batch API.
 * Profiles with full URLs or no avatar are passed through; only storage paths are signed.
 */
async function resolveBatchAvatarUrls(profiles: any[]): Promise<User[]> {
  // Separate profiles by avatar type
  const toSign: Array<{ idx: number; profile: any; path: string }> = [];
  const result: User[] = new Array(profiles.length);

  profiles.forEach((profile, idx) => {
    const user = mapProfileSync(profile);
    result[idx] = user;

    // Check if avatar needs signing (is a storage path, not a full URL or DiceBear)
    const avatarUrl = profile.avatar_url || "";
    if (avatarUrl && !/^https?:\/\//i.test(avatarUrl)) {
      toSign.push({ idx, profile, path: avatarUrl });
    }
  });

  // Batch sign all storage paths
  if (toSign.length > 0) {
    const paths = toSign.map((t) => t.path);
    const signedUrls = await batchGetImageUrls("avatars", paths);

    toSign.forEach((item, signedIdx) => {
      result[item.idx].avatar = signedUrls[signedIdx] || result[item.idx].avatar;
    });
  }

  return result;
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
    displayName: profile.display_name || profile.email?.split("@")[0] || "User",
    avatar: avatar ?? `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(profile.email)}`,
    role: normalizeRole(profile.role ?? "user"),
    online: profile.online ?? false,
    banned: profile.banned ?? false,
    bio: profile.bio ?? undefined,
  };
}

async function mapProfileAsync(profile: any): Promise<User> {
  const base = mapProfileSync(profile);
  // If avatar was a storage path, resolve it now
  if (base.avatar && !/^https?:\/\//i.test(base.avatar)) {
    try {
      base.avatar = await getImageUrl("avatars", profile.avatar_url);
    } catch {
      const fallback = `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(profile.email)}`;
      base.avatar = fallback;
    }
  }
  return base;
}

export async function listUsers(): Promise<User[]> {
  try {
    const supabase = ensureSupabase();
    const { data, error } = await supabase
      .from("profiles")
      .select("id,email,display_name,avatar_url,bio,online,banned")
      .order("display_name", { ascending: true });

    const { data: roleRows, error: rolesError } = await supabase
      .from("user_roles")
      .select("user_id,role");

    const roleMap = new Map<string, User["role"]>();
    if (!rolesError && roleRows) {
      roleRows.forEach((row: { user_id: string; role: string }) => {
        roleMap.set(row.user_id, normalizeRole(row.role));
      });
    }

    if (!error && data) {
      const normalizedProfiles = data.map((profile) => ({
        ...profile,
        role: roleMap.get(profile.id) ?? "user",
      }));

      // First pass: sync map so the UI has names/DiceBear avatars immediately
      const syncUsers = normalizedProfiles.map(mapProfileSync);
      setState((s) => { s.users = syncUsers; });

      // Second pass: batch resolve any storage-path avatars asynchronously
      resolveBatchAvatarUrls(normalizedProfiles).then((resolved) => {
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
      .select("id,email,display_name,avatar_url,bio,online,banned")
      .eq("id", id)
      .single();

    const { data: roleRows, error: rolesError } = await supabase
      .from("user_roles")
      .select("user_id,role");

    const roleMap = new Map<string, User["role"]>();
    if (!rolesError && roleRows) {
      roleRows.forEach((row: { user_id: string; role: string }) => {
        roleMap.set(row.user_id, normalizeRole(row.role));
      });
    }

    if (!error && data) {
      const user = await mapProfileAsync({ ...data, role: roleMap.get(data.id) ?? "user" });
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
