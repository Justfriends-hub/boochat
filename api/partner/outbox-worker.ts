import { createClient } from "@supabase/supabase-js";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import crypto from "crypto";

/**
 * GET/POST /api/partner/outbox-worker?secret=<CRON_SECRET>
 *
 * Delivers partner mailbox events to partner apps (e.g. MoneyMate 9ja).
 *
 * Phase 1 — ENQUEUE (poll-based, idempotent):
 *   - recent channel_posts in ACTIVE partner channels  -> type "channel_post"
 *   - recent admin DMs (2-member chats, admin sender, partner-linked
 *     recipient)                                        -> type "direct_message"
 *   Member-join rows are already enqueued by /api/partner/auth.
 *
 * Phase 2 — SEND:
 *   - POSTs pending outbox rows to the partner webhook_url with the
 *     partner's webhook_secret:
 *       x-boochat-timestamp: <unix seconds>
 *       x-boochat-signature: sha256=<hex HMAC-SHA256(secret, "<ts>.<rawBody>")>
 *   - Marks rows sent/failed with exponential backoff (max 10 attempts).
 *
 * Scheduling: Vercel Cron (see vercel.json, every 5 min). Also safe to call
 * manually with ?secret=. Requires CRON_SECRET env (fail closed).
 *
 * Environment variables required:
 * - SUPABASE_URL (+ SUPABASE_SERVICE_ROLE_KEY)
 * - CRON_SECRET
 * - PARTNER_APP_URL (public app base URL for deep links, e.g.
 *   https://moneymatesupport.online). Falls back to VITE_API_URL.
 */

const ENQUEUE_WINDOW_MIN = 20;
const SEND_LIMIT = 25;
const RECIPIENTS_PER_BATCH = 100;
const MAX_ATTEMPTS = 10;
const SEND_TIMEOUT_MS = 15000;

function env(name: string): string {
  return process.env[name] || "";
}

function hmacHex(secret: string, msg: string): string {
  return crypto.createHmac("sha256", secret).update(msg).digest("hex");
}

function isAuthorized(req: VercelRequest): boolean {
  const secret = env("CRON_SECRET");
  if (!secret) return false;
  try {
    const auth = String(req.headers.authorization || "");
    if (auth === `Bearer ${secret}`) return true;
    const q = req.query as Record<string, unknown>;
    const qs = String(q?.secret ?? "");
    if (qs && qs === secret) return true;
  } catch {}
  return false;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

interface PartnerRow {
  id: string;
  slug: string;
  name: string;
  channel_id: string;
  webhook_url: string | null;
  webhook_secret: string | null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  if (!isAuthorized(req)) {
    return res.status(401).json({ error: "Unauthorized (CRON_SECRET)" });
  }

  const supabaseUrl = env("SUPABASE_URL") || env("VITE_SUPABASE_URL");
  const serviceRoleKey = env("SUPABASE_SERVICE_ROLE_KEY") || env("VITE_SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("outbox-worker: missing Supabase env config");
    return res.status(500).json({ error: "Server misconfiguration" });
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const appUrl = (env("PARTNER_APP_URL") || env("VITE_API_URL") || "").replace(/\/$/, "");

  const stats = { partners: 0, enqueuedPosts: 0, enqueuedDMs: 0, sent: 0, failed: 0 };

  try {
    const { data: partners, error: pErr } = await supabase
      .from("partner_sources")
      .select("id, slug, name, channel_id, webhook_url, webhook_secret")
      .eq("active", true);
    if (pErr) throw pErr;

    const windowStart = new Date(Date.now() - ENQUEUE_WINDOW_MIN * 60 * 1000).toISOString();

    for (const p of ((partners || []) as PartnerRow[])) {
      stats.partners += 1;
      try {
        stats.enqueuedPosts += await enqueueChannelPosts(supabase, p, windowStart, appUrl);
      } catch (e) {
        console.error("outbox-worker: enqueue posts failed", p.slug, e);
      }
      try {
        stats.enqueuedDMs += await enqueueAdminDMs(supabase, p, windowStart, appUrl);
      } catch (e) {
        console.error("outbox-worker: enqueue DMs failed", p.slug, e);
      }
    }

    const sendStats = await sendPending(supabase);
    stats.sent = sendStats.sent;
    stats.failed = sendStats.failed;

    return res.status(200).json({ success: true, ...stats });
  } catch (e: any) {
    console.error("outbox-worker error:", e);
    return res.status(500).json({ success: false, error: "Server error" });
  }
}

/** Resolve partner-linked external ids for channel members (MoneyMate ids). */
async function resolveRecipients(supabase: any, partnerId: string, channelId: string, excludeBoochatIds: string[] = []): Promise<string[]> {
  const { data: members } = await supabase
    .from("channel_members")
    .select("user_id")
    .eq("channel_id", channelId)
    .limit(5000);
  const memberIds = ((members || []) as any[])
    .map((m) => String(m?.user_id || ""))
    .filter((id) => id && !excludeBoochatIds.includes(id));
  if (memberIds.length === 0) return [];
  // external_identities maps boochat user_id -> partner external_user_id
  const extIds: string[] = [];
  for (const batch of chunk(memberIds, 500)) {
    const { data: links } = await supabase
      .from("external_identities")
      .select("external_user_id")
      .eq("partner_id", partnerId)
      .in("user_id", batch);
    for (const l of (links || []) as any[]) {
      if (l?.external_user_id) extIds.push(String(l.external_user_id));
    }
  }
  return [...new Set(extIds)];
}

async function existingEventIds(supabase: any, partnerId: string, eventIds: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  if (eventIds.length === 0) return found;
  for (const batch of chunk(eventIds, 200)) {
    const { data } = await supabase
      .from("partner_webhook_outbox")
      .select("event_id")
      .eq("partner_id", partnerId)
      .in("event_id", batch);
    for (const r of (data || []) as any[]) found.add(String(r.event_id));
  }
  return found;
}

async function displayName(supabase: any, userId: string, fallback: string): Promise<string> {
  try {
    const { data } = await supabase.from("profiles").select("display_name").eq("id", userId).maybeSingle();
    const n = String((data as any)?.display_name || "").trim();
    return n || fallback;
  } catch {
    return fallback;
  }
}

/** Enqueue recent channel broadcasts. Returns rows inserted. */
async function enqueueChannelPosts(supabase: any, p: PartnerRow, windowStart: string, appUrl: string): Promise<number> {
  const { data: posts } = await supabase
    .from("channel_posts")
    .select("id, author_id, kind, body, created_at")
    .eq("channel_id", p.channel_id)
    .gte("created_at", windowStart)
    .order("created_at", { ascending: true })
    .limit(200);
  if (!posts || posts.length === 0) return 0;

  const eventIds = (posts as any[]).map((post) => `post:${post.id}`);
  const existing = await existingEventIds(supabase, p.id, eventIds);
  const fresh = (posts as any[]).filter((post) => !existing.has(`post:${post.id}`));
  if (fresh.length === 0) return 0;

  let inserted = 0;
  for (const post of fresh) {
    const recipients = await resolveRecipients(supabase, p.id, p.channel_id, [String(post.author_id)]);
    if (recipients.length === 0) {
      // Still record the event (empty batch) so we never re-scan it.
      await supabase.from("partner_webhook_outbox").insert({
        partner_id: p.id,
        event_id: `post:${post.id}`,
        batch_no: 0,
        payload: {
          event_id: `post:${post.id}`,
          type: "channel_post",
          partner: p.slug,
          channel_id: p.channel_id,
          channel_name: p.name,
          post_id: String(post.id),
          skipped: "no_recipients",
        },
        status: "sent",
      });
      continue;
    }
    const senderName = await displayName(supabase, String(post.author_id), p.name);
    const bodyText = String(post.body || "").trim() || (post.kind === "image" ? "[Photo]" : "");
    const batches = chunk(recipients, RECIPIENTS_PER_BATCH);
    for (let b = 0; b < batches.length; b++) {
      const row = {
        partner_id: p.id,
        event_id: `post:${post.id}`,
        batch_no: b,
        payload: {
          event_id: `post:${post.id}`,
          type: "channel_post",
          partner: p.slug,
          channel_id: p.channel_id,
          channel_name: p.name,
          post_id: String(post.id),
          title: p.name,
          sender_name: senderName,
          body: bodyText,
          deep_link: appUrl ? `${appUrl}/channels/${p.channel_id}` : "",
          recipients: batches[b],
        },
      };
      const { error } = await supabase.from("partner_webhook_outbox").insert(row);
      if (!error) inserted += 1;
    }
  }
  return inserted;
}

/** Enqueue recent admin 1-1 DMs to partner-linked members. Returns rows inserted. */
async function enqueueAdminDMs(supabase: any, p: PartnerRow, windowStart: string, appUrl: string): Promise<number> {
  // Admins of the partner channel
  const { data: admins } = await supabase
    .from("channel_members")
    .select("user_id")
    .eq("channel_id", p.channel_id)
    .eq("is_admin", true)
    .limit(100);
  const adminIds = ((admins || []) as any[]).map((a) => String(a?.user_id || "")).filter(Boolean);
  if (adminIds.length === 0) return 0;

  const { data: msgs } = await supabase
    .from("messages")
    .select("id, chat_id, sender_id, body, created_at")
    .in("sender_id", adminIds)
    .is("deleted_at", null)
    .gte("created_at", windowStart)
    .order("created_at", { ascending: true })
    .limit(200);
  if (!msgs || msgs.length === 0) return 0;

  const eventIds = (msgs as any[]).map((m) => `dm:${m.id}`);
  const existing = await existingEventIds(supabase, p.id, eventIds);
  const fresh = (msgs as any[]).filter((m) => !existing.has(`dm:${m.id}`));
  if (fresh.length === 0) return 0;

  let inserted = 0;
  for (const m of fresh) {
    // Only 1-1 chats: exactly 2 members, other member is partner-linked.
    const { data: cm } = await supabase
      .from("chat_members")
      .select("user_id")
      .eq("chat_id", m.chat_id)
      .limit(10);
    const memberIds = ((cm || []) as any[]).map((r) => String(r?.user_id || "")).filter(Boolean);
    if (memberIds.length !== 2) continue;
    const otherId = memberIds.find((id) => id !== String(m.sender_id));
    if (!otherId) continue;
    const { data: link } = await supabase
      .from("external_identities")
      .select("external_user_id")
      .eq("partner_id", p.id)
      .eq("user_id", otherId)
      .maybeSingle();
    const extId = String((link as any)?.external_user_id || "");
    if (!extId) continue; // recipient is not a partner user — skip

    const senderName = await displayName(supabase, String(m.sender_id), p.name);
    const { error } = await supabase.from("partner_webhook_outbox").insert({
      partner_id: p.id,
      event_id: `dm:${m.id}`,
      batch_no: 0,
      payload: {
        event_id: `dm:${m.id}`,
        type: "direct_message",
        partner: p.slug,
        channel_id: p.channel_id,
        channel_name: p.name,
        title: senderName,
        sender_name: senderName,
        body: String(m.body || ""),
        deep_link: appUrl ? `${appUrl}/chats/${m.chat_id}` : "",
        recipients: [extId],
      },
    });
    if (!error) inserted += 1;
  }
  return inserted;
}

/** POST pending outbox rows to partner webhooks. */
async function sendPending(supabase: any): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  const nowIso = new Date().toISOString();

  const { data: rows } = await supabase
    .from("partner_webhook_outbox")
    .select("id, partner_id, event_id, batch_no, payload, attempts")
    .eq("status", "pending")
    .or(`next_attempt_at.is.null,next_attempt_at.lte.${nowIso}`)
    .order("created_at", { ascending: true })
    .limit(SEND_LIMIT);
  if (!rows || rows.length === 0) return { sent, failed };

  const partnerIds = [...new Set((rows as any[]).map((r) => String(r.partner_id)))];
  const { data: partners } = await supabase
    .from("partner_sources")
    .select("id, slug, name, webhook_url, webhook_secret")
    .in("id", partnerIds);
  const pmap = new Map<string, any>(((partners || []) as any[]).map((p) => [String(p.id), p]));

  for (const row of rows as any[]) {
    const partner = pmap.get(String(row.partner_id));
    const webhookUrl = String(partner?.webhook_url || "");
    const webhookSecret = String(partner?.webhook_secret || "");
    if (!webhookUrl || !webhookSecret) {
      // No destination configured — park as failed (no retry storm).
      await supabase
        .from("partner_webhook_outbox")
        .update({ status: "failed", last_error: "partner webhook_url/secret not configured", attempts: (row.attempts || 0) + 1 })
        .eq("id", row.id);
      failed += 1;
      continue;
    }

    // Backfill channel_name for old rows (auth.ts once wrote "string").
    const payload = { ...(row.payload || {}) };
    if (!payload.channel_name || payload.channel_name === "string") {
      payload.channel_name = String(partner?.name || payload.partner || "");
    }
    if (!payload.partner && partner?.slug) payload.partner = partner.slug;

    const rawBody = JSON.stringify(payload);
    const ts = Math.floor(Date.now() / 1000).toString();
    const sig = hmacHex(webhookSecret, `${ts}.${rawBody}`);

    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), SEND_TIMEOUT_MS);
      const resp = await fetch(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-boochat-timestamp": ts,
          "x-boochat-signature": `sha256=${sig}`,
        },
        body: rawBody,
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (resp.ok) {
        await supabase.from("partner_webhook_outbox").update({ status: "sent", last_error: null }).eq("id", row.id);
        sent += 1;
      } else {
        throw new Error(`HTTP ${resp.status}`);
      }
    } catch (e: any) {
      const attempts = (row.attempts || 0) + 1;
      const backoffSec = Math.min(Math.pow(2, attempts) * 60, 3600);
      const next = new Date(Date.now() + backoffSec * 1000).toISOString();
      await supabase
        .from("partner_webhook_outbox")
        .update({
          status: attempts >= MAX_ATTEMPTS ? "failed" : "pending",
          attempts,
          next_attempt_at: next,
          last_error: String(e?.message || e || "send failed").slice(0, 500),
        })
        .eq("id", row.id);
      failed += 1;
    }
  }
  return { sent, failed };
}
