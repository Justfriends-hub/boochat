import { ensureSupabase } from "@/lib/supabaseClient";
import { publish } from "@/lib/eventBus";
import { getState, setState, hydrateLists, normalizeRole, type User } from "@/lib/mockStore";
import { getImageUrl, batchGetImageUrls } from "@/lib/imageUpload";
import { resolveMedia, resolveDisplayUrl } from "@/lib/mediaCache";
import { getOfflineList, getSavedList, saveList } from "@/lib/offlineStore";
import { userAvatarFallback } from "@/lib/avatar";

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

  // Batch sign all storage paths, serving previously-seen avatars from the
  // device media cache (zero data on repeat loads)
  if (toSign.length > 0) {
    const paths = toSign.map((t) => t.path);
    const signedUrls = await batchGetImageUrls("avatars", paths);

    await Promise.all(toSign.map(async (item, signedIdx) => {
      const url = signedUrls[signedIdx];
      if (!url) return;
      result[item.idx].avatar = await resolveMedia(() => Promise.resolve(url), item.path);
    }));
  }

  return result;
}

/**
 * Re-hydrate cached users for offline display. The durable mirror stores RAW
 * storage paths (durable across reloads); here we convert them back to live
 * blob URLs from the device media cache. Dead blob:/signed URLs are swapped
 * for a deterministic fallback so DPs never render blank offline.
 */
export async function rehydrateUserAvatars(users: User[]): Promise<User[]> {
  return Promise.all(
    users.map(async (u: any) => {
      if (u?._avatarPath) {
        const blob = await resolveDisplayUrl(u._avatarPath).catch(() => undefined);
        if (blob && !/^https?:\/\//i.test(blob)) {
          // path resolved from device cache → use it; keep _avatarPath intact
          return { ...u, avatar: blob };
        }
      }
      // avatar may be stale blob:/signed — verify usability cheaply:
      if (/^(blob:|data:)/i.test(u.avatar || "")) {
        return { ...u, avatar: userAvatarFallback(u._avatarPath ?? u.id ?? u.email) };
      }
      return u;
    }),
  );
}

function mapProfileSync(profile: any): User {
  // For synchronous mapping, pass through avatar_url as-is.
  // Callers that need a resolved URL should use mapProfileAsync.
  const rawAvatar = profile.avatar_url || "";
  const avatar = /^https?:\/\//i.test(rawAvatar)
    ? rawAvatar  // already a full URL — use it directly
    : rawAvatar
      ? undefined // storage path — will be resolved asynchronously
      : userAvatarFallback(profile.id ?? profile.email);

  return {
    id: profile.id,
    email: profile.email,
    displayName: profile.display_name || profile.email?.split("@")[0] || "User",
    avatar: avatar ?? userAvatarFallback(profile.id ?? profile.email),
    role: normalizeRole(profile.role ?? "user"),
    online: profile.online ?? false,
    banned: profile.banned ?? false,
    bio: profile.bio ?? undefined,
    isUpgraded: !!profile.is_upgraded,
    // Durable raw path — survives reloads; used to re-resolve offline
    _avatarPath: rawAvatar && !/^https?:\/\//i.test(rawAvatar) ? rawAvatar : undefined,
  } as User & { _avatarPath?: string };
}

async function mapProfileAsync(profile: any): Promise<User> {
  const base = mapProfileSync(profile);
  // If avatar was a storage path, resolve it now (device-cached when seen before)
  if (base.avatar && !/^https?:\/\//i.test(base.avatar)) {
    try {
      base.avatar = await resolveMedia(
        () => getImageUrl("avatars", profile.avatar_url),
        profile.avatar_url,
      );
    } catch {
      const fallback = userAvatarFallback(profile.id ?? profile.email);
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
      .select("id,email,display_name,avatar_url,bio,online,banned,is_upgraded")
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

      // First pass: sync map so the UI has names/DiceBear avatars immediately.
      // Persist THIS path-preserving version to the durable mirror — resolved
      // blob:/signed URLs die on reload; raw paths rehydrate from device cache.
      const syncUsers = normalizedProfiles.map(mapProfileSync);
      setState((s) => { s.users = syncUsers; });
      saveList("users", syncUsers);

      // Second pass: batch resolve any storage-path avatars asynchronously
      // (display only — the mirror keeps the raw paths)
      resolveBatchAvatarUrls(normalizedProfiles).then((resolved) => {
        setState((s) => {
          // merge: keep _avatarPath from sync version
          s.users = s.users.map((u: any) => {
            const r = resolved.find((x) => x.id === u.id);
            return r ? { ...u, avatar: r.avatar } : u;
          });
        });
        publish("users:changed");
      }).catch(() => {});

      return syncUsers;
    }
  } catch (err) {
    console.warn("Offline or network error fetching users, returning cached users:", err);
  }
  const memoryUsers = getState().users;
  if (memoryUsers.length) {
    return rehydrateUserAvatars(memoryUsers);
  }
  const saved = await getSavedList<User & { _avatarPath?: string }>("users");
  if (saved.length) {
    hydrateLists({ users: saved });
    return rehydrateUserAvatars(saved);
  }
  return getOfflineList(
    () => getState().users,
    "users",
    (items) => hydrateLists({ users: items }),
  );
}

export async function getUser(id: string): Promise<User | undefined> {
  // Check cache first for instant response
  const cached = getState().users.find((u) => u.id === id);
  if (cached && /^https?:\/\//i.test(cached.avatar || "")) return cached;

  // Offline: serve the cached profile with a live avatar URL immediately
  if (typeof window !== "undefined" && !navigator.onLine) {
    const local = cached ?? (await getSavedList<User & { _avatarPath?: string }>("users")).find((u) => u.id === id);
    if (!local) return undefined;
    const [rehydrated] = await rehydrateUserAvatars([local]);
    return rehydrated;
  }

  try {
    const supabase = ensureSupabase();
    const { data, error } = await supabase
      .from("profiles")
      .select("id,email,display_name,avatar_url,bio,online,banned,is_upgraded")
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
  const fallback = getState().users.find((u) => u.id === id);
  if (!fallback) return undefined;
  const [rehydrated] = await rehydrateUserAvatars([fallback]);
  return rehydrated;
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
