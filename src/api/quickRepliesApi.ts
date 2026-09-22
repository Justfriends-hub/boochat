import { ensureSupabase } from "@/lib/supabaseClient";
import { publish } from "@/lib/eventBus";
import { getState, setState, type QuickReply } from "@/lib/mockStore";
import { uploadImage, batchGetImageUrls, deleteStorageFile } from "@/lib/imageUpload";

/** Quick reply pictures live in the existing chat-media bucket (no new infra). */
const QUICK_REPLY_BUCKET = "chat-media";

function isFullUrl(value?: string): boolean {
  return !!value && /^(https?:\/\/|data:|blob:)/i.test(value);
}

function isMissingImageColumn(error: any): boolean {
  const m = `${error?.message ?? ""} ${error?.details ?? ""}`.toLowerCase();
  return m.includes("image_url") && (m.includes("column") || m.includes("could not find") || m.includes("schema cache"));
}

function mapRow(row: any): QuickReply {
  const raw: string | undefined = row.image_url ?? undefined;
  return {
    id: row.id,
    userId: row.user_id,
    shortcut: row.shortcut,
    title: row.title,
    body: row.body,
    position: row.position ?? 0,
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : undefined,
    // Full URLs render as-is; storage paths resolve via _imagePath below.
    image: isFullUrl(raw) ? raw : undefined,
    _imagePath: raw && !isFullUrl(raw) ? raw : undefined,
  } as QuickReply;
}

/** Resolve durable storage paths to display URLs (session-cached, cheap). */
async function resolveQuickReplyImages(items: QuickReply[]): Promise<QuickReply[]> {
  const need = items.filter((q) => q._imagePath && !q.image);
  if (!need.length) return items;
  try {
    const urls = await batchGetImageUrls(QUICK_REPLY_BUCKET, need.map((q) => q._imagePath));
    const urlById = new Map<string, string>();
    need.forEach((q, i) => {
      const u = urls[i];
      if (u && /^(https?:\/\/|data:|blob:)/i.test(u)) urlById.set(q.id, u);
    });
    if (!urlById.size) return items;
    return items.map((q) => (urlById.has(q.id) ? { ...q, image: urlById.get(q.id) } : q));
  } catch {
    return items;
  }
}

export async function listQuickReplies(userId: string): Promise<QuickReply[]> {
  // Return local cache immediately
  const cached = getState().quickReplies.filter((q) => q.userId === userId).sort((a, b) => a.position - b.position);

  if (typeof window !== "undefined" && navigator.onLine) {
    try {
      const supabase = ensureSupabase();
      const { data, error } = await supabase
        .from("quick_replies")
        .select("*")
        .eq("user_id", userId)
        .order("position", { ascending: true });
      if (!error && data) {
        const mapped = await resolveQuickReplyImages(data.map(mapRow));
        setState((s) => {
          // replace user's quick replies cache
          s.quickReplies = s.quickReplies.filter((q) => q.userId !== userId).concat(mapped);
        });
        return mapped;
      }
    } catch (err) {
      console.warn("Failed fetching quick replies, serving cached:", err);
    }
  }

  return resolveQuickReplyImages(cached);
}

export async function createQuickReply(userId: string, input: { shortcut: string; title: string; body: string; imageFile?: File }) {
  // Local validation: max 50
  const existing = getState().quickReplies.filter((q) => q.userId === userId);
  if (existing.length >= 50) throw new Error("Maximum of 50 quick replies reached");
  if (existing.some((q) => q.shortcut === input.shortcut)) throw new Error("Duplicate shortcut");

  if (typeof window !== "undefined" && navigator.onLine) {
    const supabase = ensureSupabase();

    // Ensure user is upgraded
    const { data: profile, error: profErr } = await supabase.from("profiles").select("is_upgraded").eq("id", userId).single();
    if (profErr || !profile || !profile.is_upgraded) throw new Error("User is not upgraded");

    // Check count on server
    const { count } = await supabase.from("quick_replies").select("id", { count: "exact", head: false }).eq("user_id", userId) as any;
    if (typeof count === "number" && count >= 50) throw new Error("Maximum of 50 quick replies reached");

    // Upload picture first (optional) — stored as a path, resolved on read.
    let imagePath: string | undefined;
    if (input.imageFile) {
      imagePath = await uploadImage(input.imageFile, QUICK_REPLY_BUCKET, `${userId}/quick-replies`, { maxDim: 512 });
    }

    const insert: any = {
      user_id: userId,
      shortcut: input.shortcut,
      title: input.title,
      body: input.body,
      position: existing.length,
    };
    if (imagePath) insert.image_url = imagePath;

    let { data, error } = await supabase.from("quick_replies").insert([insert]).select().single();
    let imageSkipped = false;
    if (error && imagePath && isMissingImageColumn(error)) {
      // Server hasn't run the image_url migration yet — save text-only.
      console.warn("quick_replies.image_url missing on server, saving text-only. Run migrations/2026-09-23_quick_reply_images.sql.");
      delete insert.image_url;
      imageSkipped = true;
      const retry = await supabase.from("quick_replies").insert([insert]).select().single();
      data = retry.data;
      error = retry.error;
      if (!retry.error && imagePath) {
        // Roll back the orphaned upload so storage doesn't fill with unused files.
        await deleteStorageFile(QUICK_REPLY_BUCKET, imagePath);
      }
    }
    if (error || !data) throw new Error(error?.message || "Failed to create quick reply");
    const created = (await resolveQuickReplyImages([mapRow(data)]))[0];
    if (imageSkipped) (created as any).imageSkipped = true;
    setState((s) => { s.quickReplies.push(created); });
    publish("quick_replies:changed");
    return created;
  }

  // Offline/mock mode: create locally
  const id = `local-${Date.now()}-${Math.random().toString(36).slice(2,6)}`;
  const created: QuickReply = {
    id,
    userId,
    shortcut: input.shortcut,
    title: input.title,
    body: input.body,
    position: existing.length,
    createdAt: Date.now(),
    // Local preview only — syncs as text-only until the server row exists.
    image: input.imageFile ? URL.createObjectURL(input.imageFile) : undefined,
  } as QuickReply;
  setState((s) => { s.quickReplies.push(created); });
  publish("quick_replies:changed");
  return created;
}

export async function updateQuickReply(id: string, patch: Partial<{ shortcut: string; title: string; body: string; position: number; image: string | null } & { imageFile: File }>) {
  const supabase = ensureSupabase();
  if (typeof window !== "undefined" && navigator.onLine) {
    const update: any = {};
    if (patch.shortcut !== undefined) update.shortcut = patch.shortcut;
    if (patch.title !== undefined) update.title = patch.title;
    if (patch.body !== undefined) update.body = patch.body;
    if (patch.position !== undefined) update.position = patch.position;

    // Picture replace / remove. Old storage file is cleaned up best-effort.
    const prev = getState().quickReplies.find((q) => q.id === id);
    if (patch.imageFile) {
      const prefix = prev ? `${prev.userId}/quick-replies` : "quick-replies";
      update.image_url = await uploadImage(patch.imageFile, QUICK_REPLY_BUCKET, prefix, { maxDim: 512 });
    } else if (patch.image !== undefined) {
      update.image_url = patch.image;
    }

    let { error, data } = await supabase.from("quick_replies").update(update).eq("id", id).select().single();
    if (error && update.image_url !== undefined && isMissingImageColumn(error)) {
      console.warn("quick_replies.image_url missing on server, saving text-only. Run migrations/2026-09-23_quick_reply_images.sql.");
      delete update.image_url;
      const retry = await supabase.from("quick_replies").update(update).eq("id", id).select().single();
      error = retry.error;
      data = retry.data;
    }
    if (error) throw new Error(error.message);
    if (patch.imageFile && prev?._imagePath) {
      await deleteStorageFile(QUICK_REPLY_BUCKET, prev._imagePath);
    }
    if (patch.image === null && prev?._imagePath) {
      await deleteStorageFile(QUICK_REPLY_BUCKET, prev._imagePath);
    }
    const updated = (await resolveQuickReplyImages([mapRow(data)]))[0];
    setState((s) => {
      const idx = s.quickReplies.findIndex((q) => q.id === id);
      if (idx >= 0) s.quickReplies[idx] = updated;
    });
    publish("quick_replies:changed");
    return updated;
  }

  // Offline/local
  const localPatch: Record<string, unknown> = {};
  if (patch.shortcut !== undefined) localPatch.shortcut = patch.shortcut;
  if (patch.title !== undefined) localPatch.title = patch.title;
  if (patch.body !== undefined) localPatch.body = patch.body;
  if (patch.position !== undefined) localPatch.position = patch.position;
  if (patch.image !== undefined) localPatch.image = patch.image;
  if (patch.imageFile) localPatch.image = URL.createObjectURL(patch.imageFile);
  setState((s) => {
    const idx = s.quickReplies.findIndex((q) => q.id === id);
    if (idx >= 0) {
      s.quickReplies[idx] = { ...s.quickReplies[idx], ...localPatch, updatedAt: Date.now() } as QuickReply;
    }
  });
  publish("quick_replies:changed");
  return getState().quickReplies.find((q) => q.id === id);
}

export async function deleteQuickReply(id: string) {
  const prev = getState().quickReplies.find((q) => q.id === id);
  if (typeof window !== "undefined" && navigator.onLine) {
    const supabase = ensureSupabase();
    const { error } = await supabase.from("quick_replies").delete().eq("id", id);
    if (error) throw new Error(error.message);
    if (prev?._imagePath) {
      await deleteStorageFile(QUICK_REPLY_BUCKET, prev._imagePath);
    }
    setState((s) => { s.quickReplies = s.quickReplies.filter((q) => q.id !== id); });
    publish("quick_replies:changed");
    return;
  }
  setState((s) => { s.quickReplies = s.quickReplies.filter((q) => q.id !== id); });
  publish("quick_replies:changed");
}

export async function reorderQuickReplies(userId: string, orderedIds: string[]) {
  // Update local positions immediately
  setState((s) => {
    const userQs = s.quickReplies.filter((q) => q.userId === userId);
    orderedIds.forEach((id, idx) => {
      const q = s.quickReplies.find((x) => x.id === id && x.userId === userId);
      if (q) q.position = idx;
    });
    // sort to keep array predictable
    s.quickReplies = s.quickReplies.filter((q) => q.userId !== userId).concat(s.quickReplies.filter((q) => q.userId === userId).sort((a,b)=>a.position-b.position));
  });
  publish("quick_replies:changed");

  if (typeof window !== "undefined" && navigator.onLine) {
    const supabase = ensureSupabase();
    // persist positions; do best-effort updates
    for (let i = 0; i < orderedIds.length; i++) {
      const id = orderedIds[i];
      try {
        await supabase.from("quick_replies").update({ position: i }).eq("id", id);
      } catch {}
    }
  }
}

export async function searchQuickReplies(userId: string, query: string): Promise<QuickReply[]> {
  const list = await listQuickReplies(userId);
  if (!query || !query.trim()) return list;
  const q = query.trim().toLowerCase();
  return list.filter((r) => (
    (r.title || "").toLowerCase().includes(q) ||
    (r.shortcut || "").toLowerCase().includes(q) ||
    (r.body || "").toLowerCase().includes(q)
  ));
}
