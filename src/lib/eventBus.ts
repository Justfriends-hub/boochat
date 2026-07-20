// Lightweight pub/sub used to simulate realtime. When swapping to Supabase,
// replace subscribe/unsubscribe/publish with supabase.channel(...).on(...).
type Handler = (payload: any) => void;
const listeners = new Map<string, Set<Handler>>();

export function subscribe(topic: string, handler: Handler): () => void {
  if (!listeners.has(topic)) listeners.set(topic, new Set());
  listeners.get(topic)!.add(handler);
  return () => unsubscribe(topic, handler);
}
export function unsubscribe(topic: string, handler: Handler) {
  listeners.get(topic)?.delete(handler);
}
export function publish(topic: string, payload?: any) {
  listeners.get(topic)?.forEach((h) => {
    try { h(payload); } catch (e) { console.error(e); }
  });
  // Fan out to wildcard subs
  listeners.get("*")?.forEach((h) => h({ topic, payload }));
}
