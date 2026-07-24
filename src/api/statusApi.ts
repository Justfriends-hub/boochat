import { ensureSupabase } from "@/lib/supabaseClient";
import { publish } from "@/lib/eventBus";
import { getState, setState, uid, type Status } from "@/lib/mockStore";

const STATUS_BUCKET = "status-media";

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
  };
}

async function getMediaUrl(mediaUrl: string) {
  if (!mediaUrl) return mediaUrl;
  try {
    const supabase = ensureSupabase();
    const { data, error } = await supabase.storage
      .from(STATUS_BUCKET)
      .createSignedUrl(mediaUrl, 60 * 60);
    if (error || !data?.signedUrl) {
      return mediaUrl;
    }
    return data.signedUrl;
  } catch {
    return mediaUrl;
  }
}

const STATUS_EXPIRY_MS = 24 * 60 * 60 * 1000;

export async function listActiveStatuses(): Promise<Status[]> {
  try {
    const supabase = ensureSupabase();
    const { data, error } = await supabase
      .from("statuses")
      .select("*, status_views(viewer_id), status_reactions(user_id,emoji)")
      .or("expires_at.gt.now(),expires_at.is.null");

    if (!error && data) {
      const statuses = (data ?? []).map((row: any) => ({ ...mapStatus(row), media: row.media_url }));
      const signedStatuses = await Promise.all(
        statuses.map(async (status) => ({
          ...status,
          media: await getMediaUrl(status.media),
        })),
      );

      setState((s) => {
        // Merge Supabase statuses with local ones
        const existingIds = new Set(signedStatuses.map((st) => st.id));
        const localOnly = s.statuses.filter((st) => !existingIds.has(st.id) && !isExpired(st));
        s.statuses = [...signedStatuses, ...localOnly];
      });
      return getState().statuses.filter((s) => !isExpired(s));
    }
  } catch (err) {
    console.warn("Unable to fetch active statuses online, returning cached statuses:", err);
  }
  return getState().statuses.filter((s) => !isExpired(s));
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
        const mapped = mapStatus({ ...data, media_url: path, media });
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
  } catch {}
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
