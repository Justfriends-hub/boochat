// Lightweight pub/sub used to simulate realtime. When swapping to Supabase,
// replace subscribe/unsubscribe/publish with supabase.channel(...).on(...).
type Handler = (payload: any) => void;
const listeners = new Map<string, Set<Handler>>();

// Unique id for this window/tab so broadcasts from self can be ignored
const SENDER_ID = Math.random().toString(36).slice(2);

// Cross-tab channel name
const CHANNEL_NAME = "boochat.eventbus";

let bc: BroadcastChannel | null = null;
try {
  if (typeof BroadcastChannel !== "undefined") {
    bc = new BroadcastChannel(CHANNEL_NAME);
    bc.onmessage = (ev) => {
      const msg = ev.data as { topic: string; payload: any; sender?: string } | null;
      if (!msg || msg.sender === SENDER_ID) return; // ignore messages from self
      listeners.get(msg.topic)?.forEach((h) => {
        try { h(msg.payload); } catch (e) { console.error(e); }
      });
      // wildcard listeners
      listeners.get("*")?.forEach((h) => {
        try { h({ topic: msg.topic, payload: msg.payload }); } catch (e) { console.error(e); }
      });
    };
  }
} catch (err) {
  bc = null;
}

// storage fallback: listen for cross-tab localStorage events
if (typeof window !== "undefined") {
  window.addEventListener("storage", (ev) => {
    try {
      if (ev.key !== "__boochat_event_v1" || !ev.newValue) return;
      const msg = JSON.parse(ev.newValue) as { topic: string; payload: any; sender?: string };
      if (!msg || msg.sender === SENDER_ID) return;
      listeners.get(msg.topic)?.forEach((h) => {
        try { h(msg.payload); } catch (e) { console.error(e); }
      });
      listeners.get("*")?.forEach((h) => {
        try { h({ topic: msg.topic, payload: msg.payload }); } catch (e) { console.error(e); }
      });
    } catch (err) {
      // ignore parse errors
    }
  });
}

export function subscribe(topic: string, handler: Handler): () => void {
  if (!listeners.has(topic)) listeners.set(topic, new Set());
  listeners.get(topic)!.add(handler);
  return () => unsubscribe(topic, handler);
}
export function unsubscribe(topic: string, handler: Handler) {
  listeners.get(topic)?.delete(handler);
}
export function publish(topic: string, payload?: any) {
  // call local handlers immediately
  listeners.get(topic)?.forEach((h) => {
    try { h(payload); } catch (e) { console.error(e); }
  });
  listeners.get("*")?.forEach((h) => {
    try { h({ topic, payload }); } catch (e) { console.error(e); }
  });

  // Broadcast to other tabs/contexts
  const msg = { topic, payload, sender: SENDER_ID };
  try {
    if (bc) {
      bc.postMessage(msg);
    } else if (typeof window !== "undefined") {
      // storage event does not fire in same window, so write then immediately remove
      try {
        window.localStorage.setItem("__boochat_event_v1", JSON.stringify(msg));
        // cleanup to avoid accumulating values
        window.localStorage.removeItem("__boochat_event_v1");
      } catch {}
    }
  } catch (err) {
    // ignore broadcast failures
  }
}
