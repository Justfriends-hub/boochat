import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const supabaseConfigured = Boolean(supabaseUrl && supabaseKey);

/**
 * Requests that can't reach the server should fail FAST so offline fallbacks
 * render immediately instead of hanging on OS-level TCP timeouts (which can
 * take 30s+ on mobile). 8s covers slow-but-alive connections comfortably.
 */
const FETCH_TIMEOUT_MS = 8_000;

function timeoutFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  return fetch(input, { ...(init ?? {}), signal: init?.signal ?? controller.signal })
    .catch((err: unknown) => {
      // Network died unexpectedly while we believed we were online — surface
      // it so the connectivity pill flips back to red immediately.
      if ((err as { name?: string } | null)?.name === "AbortError") {
        void import("@/stores/syncStore").then((m) => m.reportNetworkFailure());
      }
      throw err;
    })
    .finally(() => clearTimeout(timer));
}

export const supabase: SupabaseClient | null = supabaseConfigured
  ? createClient(supabaseUrl, supabaseKey, {
      auth: {
        persistSession: true,
        storage: typeof window === "undefined" ? undefined : window.localStorage,
      },
      global: { fetch: timeoutFetch },
    })
  : null;

export function ensureSupabase(): SupabaseClient {
  if (!supabaseConfigured || !supabase) {
    console.warn("⚠️ Supabase not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.");
    throw new Error("Supabase is not configured. Please set environment variables.");
  }
  return supabase;
}
