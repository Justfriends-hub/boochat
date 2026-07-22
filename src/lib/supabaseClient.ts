import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const supabaseConfigured = Boolean(supabaseUrl && supabaseKey);

export const supabase: SupabaseClient | null = supabaseConfigured
  ? createClient(supabaseUrl, supabaseKey, {
      auth: {
        persistSession: true,
        storage: typeof window === "undefined" ? undefined : window.localStorage,
      },
    })
  : null;

export function ensureSupabase(): SupabaseClient {
  if (!supabaseConfigured || !supabase) {
    console.warn("⚠️ Supabase not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.");
    throw new Error("Supabase is not configured. Please set environment variables.");
  }
  return supabase;
}
