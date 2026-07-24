import { ensureSupabase } from "@/lib/supabaseClient";
import { publish } from "@/lib/eventBus";
import { getState, setState, uid, type Status } from "@/lib/mockStore";
import { useUIStore } from "@/stores/uiStore";

const STATUS_BUCKET = "status-media";

// Signed URL cache: stores { [path]: { url: string, expiresAt: number } }
function getSignedUrlCache(): Record<string, { url: string; expiresAt: number }> {
  if (typeof window === "undefined") return {};
  try {
    const cached = sessionStorage.getItem("chatapp.signedUrls");
    return cached ? JSON.parse(cached) : {};
  } catch {
    return {};
  }
}

function saveSignedUrlCache(cache: Record<string, { url: string; expiresAt: number }>) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem("chatapp.signedUrls", JSON.stringify(cache));
  } catch {}
}

function getCachedSignedUrl(path: string): string | null {
  const cache = getSignedUrlCache();
  const entry = cache[path];
  if (entry && entry.expiresAt > Date.now()) {
    return entry.url;
  }
  // Clean up expired entry
  if (entry) {
    delete cache[path];
    saveSignedUrlCache(cache);
  }
  return null;
}

function setCachedSignedUrl(path: string, url: string, expiresAt: number) {
  const cache = getSignedUrlCache();
  cache[path] = { url, expiresAt };
  saveSignedUrlCache(cache);
}

export function isExpired(s: Status) {
  return Date.now() - s.createdAt > 24 * 60 * 60 * 1000;
}

function mapStatus(row: any): Status {
  return {
    id: row.id,
    userId: row.user_id,
    kind: row.kind,
    media: row.media || row.media_url || "",
    caption: row.caption ?? undefined,
    createdAt: new Date(row.created_at).getTime(),
    viewedBy: (row.status_views ?? []).map((view: any) => view.viewer_id),
    reactions: (row.status_reactions ?? []).map((reaction: any) => ({
      userId: reaction.user_id,
      emoji: reaction.emoji,
    })),
    storagePath: row.media_url || row.media || undefined,
    privacyMode: row.privacy_mode ?? row.status_privacy_mode ?? undefined,
    privacyList: row.status_privacy_list ?? row.privacy_list ?? undefined,
  };
}

async function getMediaUrl(mediaUrl: string) {
  if (!mediaUrl) return mediaUrl;
  
  // Check session cache first
  const cached = getCachedSignedUrl(mediaUrl);
  if (cached) return cached;
  
  try {
    const supabase = ensureSupabase();
    const { data, error } = await supabase.storage
      .from(STATUS_BUCKET)
      .createSignedUrl(mediaUrl, 60 * 60);
    if (error || !data?.signedUrl) {
      return mediaUrl;
    }
    // Cache for 59 minutes (signed URL is valid for 60)
    setCachedSignedUrl(mediaUrl, data.signedUrl, Date.now() + 59 * 60 * 1000);
    return data.signedUrl;
  } catch {
    return mediaUrl;
  }
}

// Batch sign multiple media URLs in parallel instead of sequential
async function batchGetMediaUrls(mediaUrls: string[]): Promise<string[]> {
  if (!mediaUrls.length) return [];
  const results = await Promise.allSettled(mediaUrls.map((url) => getMediaUrl(url)));
  return results.map((result, idx) => (result.status === "fulfilled" ? result.value : mediaUrls[idx]));
}

async function deleteStatusMedia(status?: Pick<Status, "media" | "storagePath">) {
  const storagePath = status?.storagePath || status?.media;
  if (!storagePath || /^(https?:\/\/|data:)/i.test(storagePath)) return;
  try {
    const supabase = ensureSupabase();
    await supabase.storage.from(STATUS_BUCKET).remove([storagePath]);
  } catch {}
}

async function pruneExpiredStatuses() {
  const expired = getState().statuses.filter((s) => isExpired(s));
  if (!expired.length) return;

  await Promise.all(expired.map((status) => deleteStatusMedia(status)));
  setState((s) => {
    s.statuses = s.statuses.filter((st) => !isExpired(st));
  });
}

const STATUS_EXPIRY_MS = 24 * 60 * 60 * 1000;

export async function listActiveStatuses(viewerId?: string): Promise<Status[]> {
  try {
    await pruneExpiredStatuses();

    const supabase = ensureSupabase();
    const { data, error } = await supabase
      .from("statuses")
      .select("*, status_views(viewer_id), status_reactions(user_id,emoji)")
      .or("expires_at.gt.now(),expires_at.is.null");

    if (!error && data) {
      const statuses = (data ?? []).map((row: any) => ({ ...mapStatus(row), media: row.media_url }));
      
      // Batch sign all media URLs in parallel instead of sequential
      const mediaUrls = statuses.map((s) => s.media);
      const signedUrls = await batchGetMediaUrls(mediaUrls);
      const signedStatuses = statuses.map((status, idx) => ({
        ...status,
        media: signedUrls[idx],
      }));

      setState((s) => {
        const existingIds = new Set(signedStatuses.map((st) => st.id));
        const localOnly = s.statuses.filter((st) => !existingIds.has(st.id) && !isExpired(st));
        const merged = [...signedStatuses, ...localOnly];
        
        // Proper deduplication: keep latest by ID
        const byId = new Map<string, Status>();
        merged.forEach((st) => {
          const existing = byId.get(st.id);
          // Keep the version with more updated viewedBy/reactions info
          if (!existing || existing.viewedBy.length < st.viewedBy.length) {
            byId.set(st.id, st);
          }
        });
        
        s.statuses = Array.from(byId.values()).sort((a, b) => b.createdAt - a.createdAt);
      });
      
      // apply privacy filtering for viewerId when provided
      const all = getState().statuses.filter((s) => !isExpired(s)).sort((a, b) => b.createdAt - a.createdAt);
      if (!viewerId) return all;
      return all.filter((st) => isVisibleTo(st, viewerId));
    }
  } catch (err) {
    console.warn("Unable to fetch active statuses online, returning cached statuses:", err);
  }
  const all = getState().statuses.filter((s) => !isExpired(s)).sort((a, b) => b.createdAt - a.createdAt);
  if (!viewerId) return all;
  return all.filter((st) => isVisibleTo(st, viewerId));
}

function areContacts(userA: string, userB: string) {
  const s = getState();
  return s.chats.some((c) => c.type === "dm" && c.memberIds.includes(userA) && c.memberIds.includes(userB));
}

function isVisibleTo(status: Status, viewerId: string) {
  if (!viewerId) return true;
  if (status.userId === viewerId) return true;
  const mode = status.privacyMode || "public";
  const list = status.privacyList || [];

  switch (mode) {
    case "public":
      return true;
    case "contacts":
      return areContacts(status.userId, viewerId);
    case "contacts_except":
      return areContacts(status.userId, viewerId) && !list.includes(viewerId);
    case "only":
    case "only_share_with":
      return list.includes(viewerId);
    default:
      return true;
  }
}

export async function createStatus(input: {
  userId: string; kind: "image" | "video"; media: string; caption?: string;
}): Promise<Status> {
  const newStatus: Status = {
    id: uid(),
    userId: input.userId,
    kind: input.kind,
    media: input.media,
    caption: input.caption,
    createdAt: Date.now(),
    viewedBy: [],
    reactions: [],
  };

  try {
    const response = await fetch(input.media);
    const blob = await response.blob();
    const extension = blob.type.split("/")[1] || "bin";
    const path = `${input.userId}/${Date.now()}.${extension}`;

    const supabase = ensureSupabase();
    const { error: uploadError } = await supabase.storage
      .from(STATUS_BUCKET)
      .upload(path, blob);

    if (!uploadError) {
      const expiresAt = new Date(Date.now() + STATUS_EXPIRY_MS).toISOString();
      const { data, error } = await supabase
        .from("statuses")
        .insert([
          {
            user_id: input.userId,
            kind: input.kind,
            media_url: path,
            caption: input.caption,
            expires_at: expiresAt,
          },
        ])
        .select("*, status_views(viewer_id), status_reactions(user_id,emoji)")
        .single();

      if (!error && data) {
        const media = await getMediaUrl(path);
        const mapped = {
          ...mapStatus({ ...data, media_url: path, media }),
          media,
          storagePath: path,
        };
        setState((s) => { s.statuses.unshift(mapped); });
        publish("status:changed");
        return mapped;
      }
    }
  } catch (err) {
    console.warn("Supabase status upload failed, storing status locally:", err);
  }

  // Fallback to local store
  setState((s) => { s.statuses.unshift(newStatus); });
  publish("status:changed");
  return newStatus;
}

export async function markStatusViewed(id: string, userId: string) {
  if (!id || !userId) return;

  // Add to session cache
  try {
    const store = useUIStore.getState();
    store.addViewedStatus(id);
  } catch {}

  // Always update local store immediately
  setState((s) => {
    const st = s.statuses.find((x) => x.id === id);
    if (st && !st.viewedBy.includes(userId)) {
      st.viewedBy.push(userId);
    }
  });
  publish("status:changed");

  try {
    const supabase = ensureSupabase();
    await supabase
      .from("status_views")
      .upsert({ status_id: id, viewer_id: userId }, { onConflict: "status_id,viewer_id" });
  } catch (err) {
    console.warn("Unable to record status view:", err);
  }
}

export async function reactToStatus(id: string, userId: string, emoji: string) {
  setState((s) => {
    const st = s.statuses.find((x) => x.id === id);
    if (st) {
      const existing = st.reactions.find((r) => r.userId === userId);
      if (existing) existing.emoji = emoji;
      else st.reactions.push({ userId, emoji });
    }
  });
  publish("status:changed");

  try {
    const supabase = ensureSupabase();
    await supabase
      .from("status_reactions")
      .upsert(
        { status_id: id, user_id: userId, emoji },
        { onConflict: "status_id,user_id" },
      );
  } catch {}
}

export async function deleteStatus(id: string) {
  const target = getState().statuses.find((st) => st.id === id);
  if (target) {
    await deleteStatusMedia(target);
  }

  setState((s) => {
    s.statuses = s.statuses.filter((st) => st.id !== id);
  });
  publish("status:changed");

  try {
    const supabase = ensureSupabase();
    await supabase
      .from("statuses")
      .delete()
      .eq("id", id);
  } catch {}
}

export function subscribeToStatuses(cb: () => void) {
  try {
    const supabase = ensureSupabase();
    const channel = supabase.channel("statuses");
    channel.on("postgres_changes", { event: "*", schema: "public", table: "statuses" }, () => cb());
    channel.on("postgres_changes", { event: "*", schema: "public", table: "status_views" }, () => cb());
    channel.on("postgres_changes", { event: "*", schema: "public", table: "status_reactions" }, () => cb());
    channel.subscribe();
    return () => channel.unsubscribe();
  } catch {
    return () => {};
  }
}
