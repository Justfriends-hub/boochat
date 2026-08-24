/**
 * push — Web Push client helper (VAPID)
 *
 * Handles Notification permission + PushSubscription lifecycle.
 * VAPID public key must be in VITE_VAPID_PUBLIC_KEY (base64url).
 * Private key stays server-side (Edge Function).
 */

import { ensureSupabase } from "./supabaseClient";

const VAPID_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; ++i) out[i] = raw.charCodeAt(i);
  return out;
}

export function isPushSupported(): boolean {
  return typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window;
}

export function getPermission(): NotificationPermission | "unsupported" {
  if (!isPushSupported()) return "unsupported";
  return Notification.permission;
}

export async function requestPermission(): Promise<NotificationPermission> {
  if (!isPushSupported()) return "denied";
  if (Notification.permission === "granted") return "granted";
  if (Notification.permission === "denied") return "denied";
  return await Notification.requestPermission();
}

async function getReadyRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  try {
    // Wait for the active registration (installed via __root.tsx)
    return await navigator.serviceWorker.ready;
  } catch {
    return null;
  }
}

export async function getExistingSubscription(): Promise<PushSubscription | null> {
  const reg = await getReadyRegistration();
  if (!reg) return null;
  try {
    return await reg.pushManager.getSubscription();
  } catch {
    return null;
  }
}

/**
 * Subscribe this device to push. Returns the subscription or null.
 * Persists the subscription server-side in push_subscriptions.
 */
export async function subscribePush(): Promise<PushSubscription | null> {
  if (!VAPID_KEY) {
    console.warn("[push] VITE_VAPID_PUBLIC_KEY missing — skipping subscription");
    return null;
  }
  const perm = await requestPermission();
  if (perm !== "granted") return null;

  const reg = await getReadyRegistration();
  if (!reg) {
    console.warn("[push] No service worker registration ready");
    return null;
  }

  let sub = await getExistingSubscription();
  if (sub) {
    // Already subscribed — ensure server row exists and return
    await persistSubscription(sub).catch(() => {});
    return sub;
  }

  try {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_KEY),
    });
  } catch (err) {
    console.warn("[push] pushManager.subscribe failed:", err);
    return null;
  }

  await persistSubscription(sub).catch((e) => console.warn("[push] persist failed:", e));
  return sub;
}

export async function unsubscribePush(): Promise<boolean> {
  const sub = await getExistingSubscription();
  if (!sub) return true;
  const endpoint = sub.endpoint;
  try {
    await sub.unsubscribe();
  } catch (e) {
    console.warn("[push] unsubscribe failed:", e);
    return false;
  }
  // Remove server row best-effort
  try {
    const supabase = ensureSupabase();
    await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
  } catch {}
  return true;
}

async function persistSubscription(sub: PushSubscription) {
  const supabase = ensureSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const key = sub.getKey("p256dh");
  const auth = sub.getKey("auth");
  if (!key || !auth) throw new Error("Missing p256dh/auth");

  const p256dh = btoa(String.fromCharCode(...new Uint8Array(key)));
  const authStr = btoa(String.fromCharCode(...new Uint8Array(auth)));

  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      user_id: user.id,
      endpoint: sub.endpoint,
      p256dh,
      auth: authStr,
      user_agent: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 512) : null,
    },
    { onConflict: "endpoint" },
  );
  if (error) throw error;
}

/**
 * Ensure a subscription exists if permission already granted (idempotent).
 * Call after login / on app boot.
 */
export async function ensurePushSubscriptionIfGranted(): Promise<void> {
  if (!isPushSupported()) return;
  if (Notification.permission !== "granted") return;
  if (!VAPID_KEY) return;
  try {
    await subscribePush();
  } catch {}
}
