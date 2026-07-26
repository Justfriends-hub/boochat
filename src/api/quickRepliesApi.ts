import { ensureSupabase } from "@/lib/supabaseClient";
import { publish } from "@/lib/eventBus";
import { getState, setState, type QuickReply } from "@/lib/mockStore";

function mapRow(row: any): QuickReply {
  return {
    id: row.id,
    userId: row.user_id,
    shortcut: row.shortcut,
    title: row.title,
    body: row.body,
    position: row.position ?? 0,
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : undefined,
  } as QuickReply;
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
        const mapped = data.map(mapRow);
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

  return cached;
}

export async function createQuickReply(userId: string, input: { shortcut: string; title: string; body: string }) {
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

    const insert = {
      user_id: userId,
      shortcut: input.shortcut,
      title: input.title,
      body: input.body,
      position: existing.length,
    };

    const { data, error } = await supabase.from("quick_replies").insert([insert]).select().single();
    if (error || !data) throw new Error(error?.message || "Failed to create quick reply");
    const created = mapRow(data);
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
  } as QuickReply;
  setState((s) => { s.quickReplies.push(created); });
  publish("quick_replies:changed");
  return created;
}

export async function updateQuickReply(id: string, patch: Partial<{ shortcut: string; title: string; body: string; position: number }>) {
  const supabase = ensureSupabase();
  if (typeof window !== "undefined" && navigator.onLine) {
    const update: any = {};
    if (patch.shortcut !== undefined) update.shortcut = patch.shortcut;
    if (patch.title !== undefined) update.title = patch.title;
    if (patch.body !== undefined) update.body = patch.body;
    if (patch.position !== undefined) update.position = patch.position;

    const { error, data } = await supabase.from("quick_replies").update(update).eq("id", id).select().single();
    if (error) throw new Error(error.message);
    const updated = mapRow(data);
    setState((s) => {
      const idx = s.quickReplies.findIndex((q) => q.id === id);
      if (idx >= 0) s.quickReplies[idx] = updated;
    });
    publish("quick_replies:changed");
    return updated;
  }

  // Offline/local
  setState((s) => {
    const idx = s.quickReplies.findIndex((q) => q.id === id);
    if (idx >= 0) {
      s.quickReplies[idx] = { ...s.quickReplies[idx], ...patch, updatedAt: Date.now() } as QuickReply;
    }
  });
  publish("quick_replies:changed");
  return getState().quickReplies.find((q) => q.id === id);
}

export async function deleteQuickReply(id: string) {
  if (typeof window !== "undefined" && navigator.onLine) {
    const supabase = ensureSupabase();
    const { error } = await supabase.from("quick_replies").delete().eq("id", id);
    if (error) throw new Error(error.message);
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
