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

  try {
    const supabase = ensureSupabase();
    
    // Use Supabase batch API for all signed URLs in one request
    const { data, error } = await supabase.storage
      .from(STATUS_BUCKET)
      .createSignedUrls(mediaUrls, 60 * 60);

    if (!error && data) {
      return data.map((item, idx) => {
        if (item.error) {
          return mediaUrls[idx]; // Fallback to raw URL on error
        }
        // Cache for 59 minutes (signed URL is valid for 60)
        if (item.path) setCachedSignedUrl(item.path, item.signedUrl ?? "", Date.now() + 59 * 60 * 1000);
        return item.signedUrl ?? mediaUrls[idx];
      }) as string[];
    } else {
      // Fallback to individual requests
      const results = await Promise.allSettled(mediaUrls.map((url) => getMediaUrl(url)));
      return results.map((result, idx) => (result.status === "fulfilled" ? result.value : mediaUrls[idx]));
    }
  } catch {
    // Fallback: return raw URLs
    return mediaUrls;
  }
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
    let visibleStatusIds: string[] | null = null;

    try {
      const { data: ids, error: rpcError } = await supabase.rpc("visible_status_ids", {
        viewer_id: viewerId ?? null,
      });
      if (!rpcError && ids) {
        visibleStatusIds = ids as string[];
      }
    } catch {
      visibleStatusIds = null;
    }

    // Compute client-side cutoff timestamp (ISO format) so PostgREST uses proper comparison
    const nowIso = new Date().toISOString();
    const query = supabase
      .from("statuses")
      .select("*, status_views(viewer_id), status_reactions(user_id,emoji)")
      .or(`expires_at.gt.${nowIso},expires_at.is.null`);

    if (visibleStatusIds?.length) {
      query.in("id", visibleStatusIds);
    } else if (viewerId && visibleStatusIds?.length === 0) {
      return [];
    }

    // Use local cache to avoid refetching statuses we've already loaded/viewed.
    const local = getState().statuses.filter((s) => !isExpired(s));
    const localIds = new Set(local.map((s) => s.id));
    const maxLocalCreatedAt = local.reduce((max, s) => Math.max(max, s.createdAt || 0), 0);

    // We'll perform up to two lightweight fetches: (A) fetch any missing IDs that
    // visibility RPC told us about, and (B) fetch any statuses created after our
    // local cache's max `createdAt` so we only load new items.
    const rows: any[] = [];

    // A) missing by ID
    if (visibleStatusIds && visibleStatusIds.length) {
      const missing = visibleStatusIds.filter((id) => !localIds.has(id));
      if (missing.length) {
        const { data: missingRows, error: missErr } = await supabase
          .from("statuses")
          .select("*, status_views(viewer_id), status_reactions(user_id,emoji)")
          .in("id", missing);
        if (!missErr && missingRows) rows.push(...missingRows);
      }
    }

    // B) fetch new statuses created after our local cache
    const maxLocalIso = new Date(maxLocalCreatedAt || 0).toISOString();
    if (!maxLocalCreatedAt) {
      // no local cache — fall back to full query
      const { data, error } = await query;
      if (!error && data) rows.push(...data);
    } else {
      const { data: newRows, error: newErr } = await query.gt("created_at", maxLocalIso);
      if (!newErr && newRows) rows.push(...newRows);
    }

    if (rows.length) {
      const statuses = rows.map((row: any) => ({ ...mapStatus(row), media: row.media_url }));
      const mediaUrls = statuses.map((s) => s.media);
      const signedUrls = await batchGetMediaUrls(mediaUrls);
      const signedStatuses = statuses.map((status, idx) => ({ ...status, media: signedUrls[idx] }));

      setState((s) => {
        // Merge: keep existing local entries (preserve viewedBy if already present),
        // but replace or add incoming statuses.
        const byId = new Map<string, Status>();
        // seed with current local (non-expired)
        s.statuses.filter((st) => !isExpired(st)).forEach((st) => byId.set(st.id, st));
        // overlay new/synced statuses
        signedStatuses.forEach((st) => {
          const existing = byId.get(st.id);
          if (!existing) byId.set(st.id, st);
          else {
            // merge viewedBy and reactions conservatively
            const viewed = Array.from(new Set([...(existing.viewedBy || []), ...(st.viewedBy || [])]));
            const reactionsMap = new Map<string, { userId: string; emoji: string }>();
            (existing.reactions || []).forEach((r) => reactionsMap.set(r.userId, r));
            (st.reactions || []).forEach((r) => reactionsMap.set(r.userId, r));
            byId.set(st.id, { ...existing, ...st, viewedBy: viewed, reactions: Array.from(reactionsMap.values()) });
          }
        });

        // convert back to array sorted by newest
        s.statuses = Array.from(byId.values()).filter((st) => !isExpired(st)).sort((a, b) => b.createdAt - a.createdAt);
      });
    }

    const all = getState().statuses.filter((s) => !isExpired(s)).sort((a, b) => b.createdAt - a.createdAt);
    if (!viewerId) return all;
    return all.filter((st) => isVisibleTo(st, viewerId));
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
  userId: string; kind: "image" | "video"; media: File | Blob | string; caption?: string;
}): Promise<Status> {
  const newStatus: Status = {
    id: uid(),
    userId: input.userId,
    kind: input.kind,
    media: typeof input.media === "string" ? input.media : "",
    caption: input.caption,
    createdAt: Date.now(),
    viewedBy: [],
    reactions: [],
  };

  try {
    // If media is already a File or Blob, use it directly; otherwise fetch by URL string
    let blob: Blob;
    const mediaRaw = input.media as unknown;
    if (mediaRaw instanceof Blob || mediaRaw instanceof File) {
      blob = mediaRaw as Blob;
    } else {
      const response = await fetch(input.media as string);
      blob = await response.blob();
    }
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
        setState((s) => {
          // Remove any existing statuses from this same user to keep a single
          // active status per user (prevents duplicate rows in the UI).
          s.statuses = s.statuses.filter((st) => st.userId !== mapped.userId);
          s.statuses.unshift(mapped);
        });
        // Attempt best-effort cleanup on server: remove other statuses for same user
        (async () => {
          try {
            const sup = ensureSupabase();
            await sup.from("statuses").delete().eq("user_id", input.userId).neq("id", data.id);
          } catch {}
        })();
        publish("status:changed");
        return mapped;
      }
    }
  } catch (err) {
    console.warn("Supabase status upload failed, storing status locally:", err);
  }

  // Fallback to local store
  setState((s) => {
    // Remove other statuses from this user and add the new one at top
    s.statuses = s.statuses.filter((st) => st.userId !== newStatus.userId);
    s.statuses.unshift(newStatus);
  });
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
