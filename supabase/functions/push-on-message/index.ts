// deno-lint-ignore-file no-explicit-any
/**
 * push-on-message — Supabase Edge Function (Deno)
 *
 * Fans out a Web Push notification to every member of a chat when a new
 * message row is inserted, EXCLUDING the sender. Works even when recipients
 * have the app fully closed (browser wakes the service worker via the push
 * event; see public/sw.js).
 *
 * Trigger options (either works):
 *   A) Database Webhook on public.messages INSERT → POST this function.
 *      Body: { type: "INSERT", table: "messages", record: {...} }
 *   B) Direct HTTP call with { record } for testing.
 *
 * Required secrets (supabase secrets set ...):
 *   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:you@example.com)
 * SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are auto-injected by the runtime.
 *
 * Live schema references (mycurrentschema.sql):
 *   messages(chat_id, sender_id, kind message_kind(text|image|voice), body)
 *   chat_members(chat_id, user_id)
 *   profiles(id, display_name)
 *   chats(type, name)                       -- group names for titles
 *   push_subscriptions(user_id, endpoint UNIQUE, p256dh, auth)
 */

import webpush from "npm:web-push@3.6.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY");
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY");
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:support@example.com";

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

async function sb(path: string, query: string): Promise<any[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}?${query}`, {
    headers: {
      apikey: SERVICE_ROLE,
      Authorization: `Bearer ${SERVICE_ROLE}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

function preview(kind: string, body: string): string {
  if (kind === "image") return body?.trim() ? `📷 ${body}` : "📷 Photo";
  if (kind === "voice") return "🎤 Voice message";
  return body || "New message";
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
    return json({ error: "VAPID keys not configured in function secrets" }, 500);
  }

  let record: any;
  try {
    const payload = await req.json();
    // Supabase Database Webhook shape: { type, table, record }
    record = payload.record ?? payload.row ?? payload;
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const chatId: string | undefined = record?.chat_id;
  const senderId: string | undefined = record?.sender_id;
  if (!chatId || !senderId) return json({ error: "record.chat_id / record.sender_id required" }, 422);

  try {
    // 1) Recipients = chat_members minus sender
    const members = await sb("chat_members", `chat_id=eq.${chatId}&select=user_id`);
    const recipients = members.map((m: any) => m.user_id).filter((u: string) => u && u !== senderId);
    if (!recipients.length) return json({ ok: true, sent: 0, reason: "no-recipients" });

    // 2) Title context: sender display name (+ group name when applicable)
    const [senderRows, chatRows] = await Promise.all([
      sb("profiles", `id=eq.${senderId}&select=display_name`),
      sb("chats", `id=eq.${chatId}&select=name,type`),
    ]);
    const senderName: string = senderRows[0]?.display_name ?? "Someone";
    const chat = chatRows[0];
    const isGroup = chat?.type === "group";
    const title = isGroup && chat?.name ? `${senderName} · ${chat.name}` : senderName;
    const bodyText = preview(record.kind ?? "text", record.body ?? "");

    // 3) All devices per recipient
    const subs: any[] = [];
    for (const uid of recipients) {
      const rows = await sb(
        "push_subscriptions",
        `user_id=eq.${uid}&select=id,endpoint,p256dh,auth`,
      );
      subs.push(...rows);
    }

    // 4) Send fan-out; drop dead endpoints (404/410)
    let sent = 0, removed = 0;
    await Promise.all(subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify({
            title,
            body: bodyText,
            url: `/chats/${chatId}`,
            chatId,
            tag: chatId,
          }),
        );
        sent++;
      } catch (err: any) {
        const status = err?.statusCode;
        if (status === 404 || status === 410) {
          // Subscription expired/unregistered — remove it
          await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions?id=eq.${s.id}`, {
            method: "DELETE",
            headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` },
          }).catch(() => {});
          removed++;
        } else {
          console.error("send failed:", s.endpoint, err?.message ?? err);
        }
      }
    }));

    return json({ ok: true, recipients: recipients.length, subscriptions: subs.length, sent, removed });
  } catch (err: any) {
    console.error(err);
    return json({ error: err?.message ?? String(err) }, 500);
  }
});
