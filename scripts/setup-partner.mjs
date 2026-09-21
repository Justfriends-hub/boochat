#!/usr/bin/env node

/**
 * PARTNER SYSTEM SETUP SCRIPT
 * Executes all setup tasks: migration, user creation, channel, partner row, Vercel env vars
 */

import crypto from "node:crypto";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const VERCEL_TOKEN = process.env.VERCEL_TOKEN;
const SUPERADMIN_EMAIL = process.env.SUPERADMIN_EMAIL ?? "flashgain9ja@gmail.com";
const CHANNEL_NAME = process.env.PARTNER_CHANNEL_NAME ?? "Money mate 9ja";
const PARTNER_SLUG = process.env.PARTNER_SLUG ?? "moneymate9ja";
const PROJECT_NAME = process.env.VERCEL_PROJECT_NAME ?? "boochat";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing required environment variables: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

if (!VERCEL_TOKEN) {
  console.error("Missing required environment variable: VERCEL_TOKEN");
  process.exit(1);
}

let superAdminUserId = null;
let channelId = null;
const sharedSecret = crypto.randomBytes(32).toString("hex");
const webhookSecret = crypto.randomBytes(32).toString("hex");

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });

  const text = await response.text();
  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  return {
    status: response.status,
    ok: response.ok,
    data,
  };
}

function supabaseRequest(method, path, body = null) {
  const url = new URL(path, `${SUPABASE_URL.replace(/\/$/, "")}/`);
  const headers = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  };

  return requestJson(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
}

function vercelRequest(method, path, body = null) {
  const url = new URL(path, "https://api.vercel.com/");
  const headers = {
    Authorization: `Bearer ${VERCEL_TOKEN}`,
  };

  return requestJson(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function run() {
  try {
    console.log("🚀 PARTNER SYSTEM SETUP STARTING\n");

    console.log("1️⃣  Applying migration to Supabase...");
    const migrationSQL = `
-- Partner system tables
CREATE TABLE IF NOT EXISTS public.partner_sources (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  channel_id uuid NOT NULL UNIQUE REFERENCES public.channels(id) ON DELETE RESTRICT,
  shared_secret text NOT NULL,
  webhook_url text,
  webhook_secret text,
  allowed_origins text[] DEFAULT '{}',
  active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT partner_sources_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.external_identities (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES public.partner_sources(id) ON DELETE CASCADE,
  external_user_id text NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT external_identities_pkey PRIMARY KEY (id),
  CONSTRAINT external_identities_partner_external_unique UNIQUE (partner_id, external_user_id),
  CONSTRAINT external_identities_partner_user_unique UNIQUE (partner_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.partner_auth_nonces (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES public.partner_sources(id) ON DELETE CASCADE,
  nonce text NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT partner_auth_nonces_pkey PRIMARY KEY (id),
  CONSTRAINT partner_auth_nonces_partner_nonce_unique UNIQUE (partner_id, nonce)
);

CREATE TABLE IF NOT EXISTS public.partner_webhook_outbox (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES public.partner_sources(id) ON DELETE CASCADE,
  event_id text NOT NULL,
  batch_no int NOT NULL DEFAULT 0,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  attempts int NOT NULL DEFAULT 0,
  next_attempt_at timestamp with time zone,
  last_error text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT partner_webhook_outbox_pkey PRIMARY KEY (id),
  CONSTRAINT partner_webhook_outbox_event_unique UNIQUE (partner_id, event_id, batch_no)
);

CREATE INDEX IF NOT EXISTS partner_sources_slug_idx ON public.partner_sources(slug);
CREATE INDEX IF NOT EXISTS external_identities_user_id_idx ON public.external_identities(user_id);
CREATE INDEX IF NOT EXISTS partner_webhook_outbox_status_idx ON public.partner_webhook_outbox(status);

ALTER TABLE public.partner_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.external_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_auth_nonces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_webhook_outbox ENABLE ROW LEVEL SECURITY;

CREATE POLICY "partner_sources_no_direct_access" ON public.partner_sources
  FOR ALL TO authenticated USING (false) WITH CHECK (false);
CREATE POLICY "external_identities_no_direct_access" ON public.external_identities
  FOR ALL TO authenticated USING (false) WITH CHECK (false);
CREATE POLICY "partner_auth_nonces_no_direct_access" ON public.partner_auth_nonces
  FOR ALL TO authenticated USING (false) WITH CHECK (false);
CREATE POLICY "partner_webhook_outbox_no_direct_access" ON public.partner_webhook_outbox
  FOR ALL TO authenticated USING (false) WITH CHECK (false);
`;

    const migrationResponse = await supabaseRequest("POST", "/rest/v1/rpc/query_exec", { query: migrationSQL });
    if (migrationResponse.ok) {
      console.log("✅ Migration executed successfully");
    } else {
      console.log("⚠️  Migration call did not succeed; the SQL must be run in the Supabase SQL editor or via an authenticated Postgres client.");
      console.log(JSON.stringify(migrationResponse.data, null, 2));
    }

    console.log("\n2️⃣  Creating superadmin user...");
    const userResponse = await supabaseRequest("POST", "/auth/v1/admin/users", {
      email: SUPERADMIN_EMAIL,
      password: crypto.randomBytes(32).toString("hex"),
      email_confirm: true,
      user_metadata: { display_name: "Money mate Admin" },
    });

    if (userResponse.status === 201) {
      superAdminUserId = userResponse.data.user.id;
      console.log(`✅ User created: ${superAdminUserId}`);
    } else if (
      (userResponse.status === 422 && userResponse.data?.error_code === "user_already_exists") ||
      (userResponse.status === 422 && userResponse.data?.error_code === "email_exists")
    ) {
      console.log("⚠️  User already exists, fetching...");
      const existingResponse = await supabaseRequest("GET", `/auth/v1/admin/users?email=${encodeURIComponent(SUPERADMIN_EMAIL)}`);
      if (existingResponse.data?.users?.length) {
        superAdminUserId = existingResponse.data.users[0].id;
        console.log(`✅ Using existing user: ${superAdminUserId}`);
      } else {
        throw new Error("Could not find existing user");
      }
    } else {
      throw new Error(`Failed to create user: ${JSON.stringify(userResponse.data)}`);
    }

    console.log("\n3️⃣  Creating profile...");
    const profileResponse = await supabaseRequest("POST", "/rest/v1/profiles", {
      id: superAdminUserId,
      email: SUPERADMIN_EMAIL,
      display_name: "Money mate Admin",
      avatar_url: null,
      online: false,
      banned: false,
    });
    if (profileResponse.status === 201 || profileResponse.status === 409 || profileResponse.ok) {
      console.log("✅ Profile ready");
    } else {
      console.log("⚠️  Profile response:", profileResponse.status, profileResponse.data);
    }

    console.log("\n4️⃣  Creating channel...");
    const channelResponse = await supabaseRequest("POST", "/rest/v1/channels", {
      name: CHANNEL_NAME,
      description: `Official ${CHANNEL_NAME} channel`,
      owner_id: superAdminUserId,
      visibility: "public",
    });

    if (channelResponse.status === 201 || channelResponse.ok) {
      const created = Array.isArray(channelResponse.data) ? channelResponse.data[0] : channelResponse.data;
      channelId = created?.id;
      console.log(`✅ Channel created: ${channelId}`);
    } else {
      throw new Error(`Failed to create channel: ${JSON.stringify(channelResponse.data)}`);
    }

    console.log("\n5️⃣  Adding superadmin as channel admin...");
    const memberResponse = await supabaseRequest("POST", "/rest/v1/channel_members", {
      channel_id: channelId,
      user_id: superAdminUserId,
      is_admin: true,
    });
    if (memberResponse.status === 201 || memberResponse.status === 409 || memberResponse.ok) {
      console.log("✅ Superadmin added to channel");
    } else {
      console.log("⚠️  Member response:", memberResponse.status, memberResponse.data);
    }

    console.log("\n6️⃣  Creating partner_sources row...");
    const partnerId = crypto.randomUUID();
    const partnerResponse = await supabaseRequest("POST", "/rest/v1/partner_sources", {
      id: partnerId,
      slug: PARTNER_SLUG,
      name: CHANNEL_NAME,
      channel_id: channelId,
      shared_secret: sharedSecret,
      webhook_url: "https://moneymate9ja.com/api/partner/webhook",
      webhook_secret: webhookSecret,
      allowed_origins: [],
      active: true,
    });

    if (partnerResponse.status === 201 || partnerResponse.ok) {
      console.log(`✅ Partner row created: ${partnerId}`);
    } else {
      throw new Error(`Failed to create partner: ${JSON.stringify(partnerResponse.data)}`);
    }

    console.log("\n7️⃣  Setting Vercel environment variables...");
    const envVars = [
      { key: "SUPABASE_URL", value: SUPABASE_URL, target: ["production", "preview", "development"] },
      { key: "SUPABASE_SERVICE_ROLE_KEY", value: SUPABASE_SERVICE_ROLE_KEY, target: ["production", "preview", "development"] },
      { key: "VITE_API_URL", value: `https://${PROJECT_NAME}.vercel.app`, target: ["production", "preview", "development"] },
    ];

    for (const envVar of envVars) {
      const envResponse = await vercelRequest("POST", `/v10/projects/${PROJECT_NAME}/env`, envVar);
      if (envResponse.status === 200 || envResponse.status === 201 || envResponse.ok) {
        console.log(`✅ Env var set: ${envVar.key}`);
      } else {
        console.log(`⚠️  Env var response for ${envVar.key}:`, envResponse.status, envResponse.data);
      }
    }

    console.log("\n8️⃣  Triggering Vercel deployment...");
    const deployResponse = await vercelRequest("POST", "/v13/deployments?forceNew=1", {
      name: PROJECT_NAME,
      gitMetadata: { sha: "HEAD" },
    });

    if (deployResponse.status === 200 || deployResponse.status === 201 || deployResponse.ok) {
      console.log("✅ Deployment triggered");
    } else {
      console.log("⚠️  Deploy response:", deployResponse.status, deployResponse.data);
    }

    console.log("\n" + "=".repeat(60));
    console.log("✅ SETUP COMPLETE!");
    console.log("=".repeat(60));
    console.log("\n📋 SAVE THESE SECRETS FOR MONEY MATE 9JA:\n");
    console.log("Shared Secret (for JWT signing):");
    console.log(`  ${sharedSecret}\n`);
    console.log("Webhook Secret (for signature verification):");
    console.log(`  ${webhookSecret}\n`);
    console.log(`Partner Slug: ${PARTNER_SLUG}`);
    console.log(`Channel ID: ${channelId}`);
    console.log(`Superadmin Email: ${SUPERADMIN_EMAIL}`);
    console.log(`\nBoochat API Endpoint: https://${PROJECT_NAME}.vercel.app/api/partner/auth`);
    console.log(`Sign-in Link Format: https://${PROJECT_NAME}.vercel.app/auth/login?partner=${PARTNER_SLUG}&token=<JWT>`);
    console.log("\n" + "=".repeat(60));
  } catch (error) {
    console.error("❌ ERROR:", error.message);
    process.exit(1);
  }
}

run();
