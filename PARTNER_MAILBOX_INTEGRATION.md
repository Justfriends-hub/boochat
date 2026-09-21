# Partner mailbox integration — BooChat → MoneyMate 9ja

Delivers channel broadcasts + admin DMs from the **Money mate 9ja** channel
into the MoneyMate app mailbox (header shows the channel name, tap opens the
channel). Member joins were already enqueued; this adds the missing worker.

## New/changed files

| File | What |
|---|---|
| `api/partner/outbox-worker.ts` | Cron worker: enqueues recent posts/DMs, POSTs pending outbox rows to the partner webhook |
| `api/partner/auth.ts` | `member_joined` payload now carries the real channel name (was `"string"`) |
| `vercel.json` | Cron: `GET /api/partner/outbox-worker` every 5 min |
| `scripts/seed-moneymate-partner.sql` | Idempotent seed: channel + admin + `partner_sources` row |

## Webhook contract (must match MoneyMate `/api/boochat/webhook`)

- Headers: `x-boochat-timestamp: <unix seconds>`,
  `x-boochat-signature: sha256=<hex HMAC-SHA256(webhook_secret, "<ts>.<rawBody>")>`
- Body: `{ type, partner, recipients, event_id, channel_id?, channel_name?,
  title?, sender_name?, body?, deep_link? }`
- Types: `member_joined` (membership only) · `channel_post` (mailbox, kind
  `channel_broadcast`) · `direct_message` (mailbox, kind `channel_dm`)
- `recipients` are **MoneyMate user ids** (`external_identities.external_user_id`),
  because MoneyMate keeps only recipients that exist in its own `users` table.
- `deep_link` → channel (`/channels/<id>`) or chat (`/chats/<id>`); MoneyMate
  opens external links in a new tab.

## Env vars (Vercel → this project)

```
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...        # KEEP SECRET
CRON_SECRET=<openssl rand -hex 32>   # worker auth (?secret= / Bearer)
PARTNER_APP_URL=https://moneymatesupport.online   # deep-link base (no trailing /)
```

Vercel Cron calls the path with `Authorization: Bearer <CRON_SECRET>`
automatically when `CRON_SECRET` is set. Manual run:
`GET https://<app>/api/partner/outbox-worker?secret=<CRON_SECRET>`

## Setup order

1. Apply `migrations/2026-09-19_add_partner_system.sql` (if not yet applied).
2. Deploy (worker + cron go live with the deploy).
3. Run `scripts/seed-moneymate-partner.sql` in Supabase SQL Editor (fill the
   3 EDIT ME values first).
4. Copy the two secrets into MoneyMate Vercel env:
   `BOOCHAT_BASE_URL=https://moneymatesupport.online`,
   `BOOCHAT_PARTNER_SLUG=moneymate9ja`, `BOOCHAT_PARTNER_NAME=Money mate 9ja`,
   `BOOCHAT_SHARED_SECRET=<shared_secret>`,
   `BOOCHAT_WEBHOOK_SECRET=<webhook_secret>` — then redeploy MoneyMate.
5. Test: MoneyMate mailbox → Join → BooChat login → auto in channel →
   post in channel → within ~5 min a `Money mate 9ja` item lands in the
   MoneyMate mailbox. `partner_webhook_outbox.status` shows `sent`.

## Notes / limits

- Enqueue window is 20 min, cron every 5 min; `UNIQUE(partner_id,event_id,
  batch_no)` makes retries/crashes safe (no duplicates).
- DMs only cover **1-1 chats** (exactly 2 members) from a channel admin to a
  partner-linked member. Group chats are skipped by design.
- Removed/banned users: `channel_members` only holds current members, and
  `/api/partner/auth` still 403s removed users — no broadcast reaches them.
- Vercel plan cron limits apply; if 5-min crons aren't available on the
  current plan, lengthen the schedule (latency grows) or trigger manually.
- The legacy `?source=flashgain` Google-button path is intentionally left
  untouched for now — remove it once the JWT flow is verified end-to-end.
