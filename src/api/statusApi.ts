import { ensureSupabase } from "@/lib/supabaseClient";
import { publish } from "@/lib/eventBus";
import { getState, setState, type Status } from "@/lib/mockStore";

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

export async function listActiveStatuses(): Promise<Status[]> {
  try {
    const supabase = ensureSupabase();
    const { data, error } = await supabase
      .from("statuses")
      .select("*, status_views(viewer_id), status_reactions(user_id,emoji)")
      .gt("expires_at", "now()");

    if (!error && data) {
      const statuses = (data ?? []).map((row: any) => ({ ...mapStatus(row), media: row.media_url }));
      const signedStatuses = await Promise.all(
        statuses.map(async (status) => ({
          ...status,
          media: await getMediaUrl(status.media),
        })),
      );

      setState((s) => { s.statuses = signedStatuses; });
      return signedStatuses;
    }
  } catch (err) {
    console.warn("Unable to fetch active statuses online, returning cached statuses:", err);
  }
  return getState().statuses.filter((s) => !isExpired(s));
}

export async function createStatus(input: {
  userId: string; kind: "image" | "video"; media: string; caption?: string;
}): Promise<Status> {
  const response = await fetch(input.media);
  const blob = await response.blob();
  const extension = blob.type.split("/")[1] || "bin";
  const path = `${input.userId}/${Date.now()}.${extension}`;

  const supabase = ensureSupabase();
  const { error: uploadError } = await supabase.storage
    .from(STATUS_BUCKET)
    .upload(path, blob);
  if (uploadError) throw new Error(uploadError.message);

  const { data, error } = await supabase
    .from("statuses")
    .insert([
      {
        user_id: input.userId,
        kind: input.kind,
        media_url: path,
        caption: input.caption,
      },
    ])
    .select("*, status_views(viewer_id), status_reactions(user_id,emoji)")
    .single();
  if (error || !data) throw new Error(error?.message || "Unable to create status.");

  const media = await getMediaUrl(path);
  const status = mapStatus({ ...data, media_url: path, media });
  publish("status:changed");
  return status;
}

export async function markStatusViewed(id: string, userId: string) {
  const supabase = ensureSupabase();
  const { error } = await supabase
    .from("status_views")
    .upsert({ status_id: id, viewer_id: userId }, { onConflict: ["status_id", "viewer_id"] });
  if (error) throw new Error(error.message);
  publish("status:changed");
}

export async function reactToStatus(id: string, userId: string, emoji: string) {
  const supabase = ensureSupabase();
  const { error } = await supabase
    .from("status_reactions")
    .upsert(
      { status_id: id, user_id: userId, emoji },
      { onConflict: ["status_id", "user_id"] },
    );
  if (error) throw new Error(error.message);
  publish("status:changed");
}

export async function deleteStatus(id: string) {
  const supabase = ensureSupabase();
  const { error } = await supabase
    .from("statuses")
    .delete()
    .eq("id", id);
  if (error) throw new Error(error.message);
  publish("status:changed");
}

export function subscribeToStatuses(cb: () => void) {
  const supabase = ensureSupabase();
  const channel = supabase.channel("statuses");
  channel.on("postgres_changes", { event: "*", schema: "public", table: "statuses" }, () => cb());
  channel.on("postgres_changes", { event: "*", schema: "public", table: "status_views" }, () => cb());
  channel.on("postgres_changes", { event: "*", schema: "public", table: "status_reactions" }, () => cb());
  channel.subscribe();
  return () => channel.unsubscribe();
}
