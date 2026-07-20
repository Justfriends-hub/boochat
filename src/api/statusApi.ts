import { getState, setState, uid, type Status } from "@/lib/mockStore";
import { publish, subscribe } from "@/lib/eventBus";

// NOTE: Real deletion of expired statuses happens server-side via pg_cron
// (see supabase.md, Stage 4). Client-side we compute expiry against Date.now().
const STATUS_TTL_MS = 24 * 60 * 60 * 1000;

export function isExpired(s: Status) {
  return Date.now() - s.createdAt > STATUS_TTL_MS;
}

export async function listActiveStatuses(): Promise<Status[]> {
  return getState().statuses.filter((s) => !isExpired(s));
}

export async function createStatus(input: {
  userId: string; kind: "image" | "video"; media: string; caption?: string;
}): Promise<Status> {
  const st: Status = {
    id: uid(), userId: input.userId, kind: input.kind, media: input.media,
    caption: input.caption, createdAt: Date.now(), viewedBy: [], reactions: [],
  };
  setState((s) => { s.statuses.push(st); });
  publish("status:changed");
  return st;
}

export async function markStatusViewed(id: string, userId: string) {
  setState((s) => {
    const st = s.statuses.find((x) => x.id === id);
    if (st && !st.viewedBy.includes(userId)) st.viewedBy.push(userId);
  });
  publish("status:changed");
}

export async function reactToStatus(id: string, userId: string, emoji: string) {
  setState((s) => {
    const st = s.statuses.find((x) => x.id === id);
    if (st) {
      st.reactions = st.reactions.filter((r) => r.userId !== userId);
      st.reactions.push({ userId, emoji });
    }
  });
  publish("status:changed");
}

export async function deleteStatus(id: string) {
  setState((s) => { s.statuses = s.statuses.filter((x) => x.id !== id); });
  publish("status:changed");
}

export function subscribeToStatuses(cb: () => void) {
  return subscribe("status:changed", cb);
}
