import { createClient } from "@supabase/supabase-js";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { isAuthorized, runOutboxWorker } from "./partner/outbox-worker";

/**
 * GET/POST /api/cron?secret=<CRON_SECRET>
 *
 * THE single cron entry point for the whole app (see vercel.json — exactly
 * ONE daily cron, which is all the Vercel Hobby plan allows).
 *
 * Rule: NEVER add another `crons` entry to vercel.json. New scheduled jobs
 * get appended to the JOBS list below and run through this one endpoint —
 * every job pulls from this one place, so deploys never get blocked by the
 * Hobby once-per-day cron limit again.
 *
 * For sub-daily frequency without Vercel Pro, trigger this same endpoint
 * from Supabase pg_cron + pg_net (see
 * migrations/2026-09-21_partner_outbox_frequent_drain.sql). All jobs below
 * are idempotent, so overlapping triggers are safe.
 *
 * Requires CRON_SECRET env (fail closed). Vercel Cron sends
 * `Authorization: Bearer <CRON_SECRET>` automatically when the env var is set.
 */

function env(name: string): string {
  return process.env[name] || "";
}

interface JobContext {
  supabase: ReturnType<typeof createClient>;
  appUrl: string;
}

const JOBS: Array<{ name: string; run: (ctx: JobContext) => Promise<unknown> }> = [
  {
    name: "partner-outbox",
    run: (ctx) => runOutboxWorker(ctx.supabase, ctx.appUrl),
  },
  // ── Add future scheduled jobs here, e.g. ──
  // { name: "cleanup-expired-statuses", run: (ctx) => runStatusCleanup(ctx.supabase) },
];

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
    console.error("cron dispatcher: missing Supabase env config");
    return res.status(500).json({ error: "Server misconfiguration" });
  }
  const ctx: JobContext = {
    supabase: createClient(supabaseUrl, serviceRoleKey),
    appUrl: (env("PARTNER_APP_URL") || env("VITE_API_URL") || "").replace(/\/$/, ""),
  };

  const jobs: Record<string, unknown> = {};
  let failed = 0;
  for (const job of JOBS) {
    try {
      jobs[job.name] = await job.run(ctx);
    } catch (e: any) {
      failed += 1;
      console.error(`cron dispatcher: job "${job.name}" failed:`, e);
      jobs[job.name] = { success: false, error: String(e?.message || e || "job failed").slice(0, 300) };
    }
  }

  return res.status(failed ? 207 : 200).json({ success: failed === 0, jobs });
}
