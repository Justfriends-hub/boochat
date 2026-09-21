import { createClient } from "@supabase/supabase-js";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import crypto from "crypto";

/**
 * POST /api/partner/auth
 *
 * Partner sign-in endpoint. Verifies signed JWT, creates/links user, joins channel.
 * Returns session tokens + redirect URL to the channel.
 *
 * Environment variables required (Vercel, boochat project):
 * - SUPABASE_URL                (or VITE_SUPABASE_URL)
 * - SUPABASE_SERVICE_ROLE_KEY
 * - SUPABASE_ANON_KEY           (or VITE_SUPABASE_PUBLISHABLE_KEY / VITE_SUPABASE_ANON_KEY)
 *
 * Request body:
 * { "partner": "<slug>", "token": "<HS256 JWT>" }
 */

interface PartnerJWT {
  partner: string;
  ext_user_id: string;
  email: string;
  name: string;
  iat: number;
  exp: number;
  nonce: string;
}

function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

function verifyJWTSignature(token: string, secret: string): PartnerJWT | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const [headerB64, payloadB64, signatureB64] = parts;
    // Node's "base64" decoder accepts both standard and url-safe alphabets.
    const payload = JSON.parse(Buffer.from(payloadB64, "base64").toString());

    const message = `${headerB64}.${payloadB64}`;
    const computed = crypto.createHmac("sha256", secret).update(message).digest("hex");
    const provided = Buffer.from(signatureB64, "base64").toString("hex");

    if (!constantTimeCompare(computed, provided)) return null;
    return payload as PartnerJWT;
  } catch {
    return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRoleKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;
  const anonKey =
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !serviceRoleKey || !anonKey) {
    console.error("Missing Supabase env config", {
      SUPABASE_URL: !!supabaseUrl,
      SERVICE_ROLE: !!serviceRoleKey,
      ANON_KEY: !!anonKey,
    });
    return res.status(500).json({ error: "Server misconfiguration" });
  }

  try {
    // Parse inside the try so a malformed body returns 400, not a crashed function.
    let body: any;
    try {
      body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    } catch {
      return res.status(400).json({ error: "Invalid JSON body" });
    }
    const { partner: partnerSlug, token: jwtToken } = body ?? {};

    if (!partnerSlug || typeof partnerSlug !== "string") {
      return res.status(400).json({ error: "partner slug required" });
    }
    if (!jwtToken || typeof jwtToken !== "string") {
      return res.status(400).json({ error: "token required" });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // 1. Look up partner
    const { data: partnerRow, error: partnerError } = await supabase
      .from("partner_sources")
      .select("id, name, channel_id, shared_secret, active")
      .eq("slug", partnerSlug)
      .maybeSingle();

    if (partnerError) {
      console.error("partner_sources lookup failed:", partnerError);
      return res.status(500).json({ error: "Partner lookup failed" });
    }
    if (!partnerRow) {
      return res.status(404).json({ error: "Partner not found" });
    }
    if (!partnerRow.active) {
      return res.status(403).json({ error: "Partner is inactive" });
    }

    // 2. Verify JWT signature
    const payload = verifyJWTSignature(jwtToken, partnerRow.shared_secret);
    if (!payload) {
      return res.status(401).json({ error: "Invalid or expired token" });
    }
    if (payload.partner && payload.partner !== partnerSlug) {
      return res.status(401).json({ error: "Token partner mismatch" });
    }
    if (!payload.ext_user_id || !payload.email || !payload.nonce) {
      return res.status(400).json({ error: "Token missing ext_user_id, email or nonce" });
    }

    // 3. Check exp
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now) {
      return res.status(401).json({ error: "Token expired" });
    }

    const email = String(payload.email).trim().toLowerCase();
    const extUserId = String(payload.ext_user_id);

    // 4. Replay protection: check nonce
    const { data: nonceRow } = await supabase
      .from("partner_auth_nonces")
      .select("id")
      .eq("partner_id", partnerRow.id)
      .eq("nonce", payload.nonce)
      .maybeSingle();

    if (nonceRow) {
      return res.status(401).json({ error: "Token already redeemed" });
    }

    const expiresAt = new Date((payload.exp + 3600) * 1000).toISOString();
    await supabase.from("partner_auth_nonces").insert({
      partner_id: partnerRow.id,
      nonce: payload.nonce,
      expires_at: expiresAt,
    });

    // 5. Find or create user
    const { data: extIdRow } = await supabase
      .from("external_identities")
      .select("user_id")
      .eq("partner_id", partnerRow.id)
      .eq("external_user_id", extUserId)
      .maybeSingle();

    let userId: string;

    if (extIdRow) {
      userId = extIdRow.user_id;
    } else {
      const { data: profileRow } = await supabase
        .from("profiles")
        .select("id")
        .ilike("email", email)
        .maybeSingle();

      if (profileRow) {
        userId = profileRow.id;
      } else {
        const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
          email,
          email_confirm: true,
          password: crypto.randomBytes(32).toString("hex"),
          user_metadata: { display_name: payload.name },
        });

        if (createError || !newUser?.user) {
          console.error("Failed to create user:", createError);
          return res.status(500).json({ error: "Failed to create account" });
        }

        userId = newUser.user.id;

        // Upsert: a DB trigger on auth.users may already have created the profile.
        const { error: profileError } = await supabase.from("profiles").upsert({
          id: userId,
          email,
          display_name: payload.name,
          avatar_url: null,
        });
        if (profileError) console.error("Failed to upsert profile:", profileError);
      }
    }

    // 6. Check if user is banned
    const { data: profile } = await supabase
      .from("profiles")
      .select("banned")
      .eq("id", userId)
      .maybeSingle();

    if (profile?.banned) {
      return res.status(403).json({ error: "Account is banned" });
    }

    // 7. Check if user was removed from this channel
    // (removed_channel_members has no `id` column — PK is channel_id + user_id)
    const { data: removedRow } = await supabase
      .from("removed_channel_members")
      .select("user_id")
      .eq("channel_id", partnerRow.channel_id)
      .eq("user_id", userId)
      .maybeSingle();

    if (removedRow) {
      return res.status(403).json({ error: "You have been removed from this channel" });
    }

    // 8. Join channel (upsert)
    await supabase.from("channel_members").upsert({
      channel_id: partnerRow.channel_id,
      user_id: userId,
      is_admin: false,
    });

    // 9. Link external identity
    await supabase.from("external_identities").upsert({
      partner_id: partnerRow.id,
      external_user_id: extUserId,
      user_id: userId,
      email,
    });

    // 10. Enqueue member_joined event (for webhook worker)
    let joinedChannelName = "";
    try {
      const { data: chRow } = await supabase
        .from("channels")
        .select("name")
        .eq("id", partnerRow.channel_id)
        .maybeSingle();
      joinedChannelName = String((chRow as any)?.name || "");
    } catch {}
    await supabase.from("partner_webhook_outbox").insert({
      partner_id: partnerRow.id,
      event_id: `joined:${partnerRow.id}:${extUserId}`,
      batch_no: 0,
      payload: {
        event_id: `joined:${partnerRow.id}:${extUserId}`,
        type: "member_joined",
        partner: partnerSlug,
        channel_id: partnerRow.channel_id,
        channel_name: joinedChannelName,
        recipients: [extUserId],
      },
    });

    // 11. Create session.
    // supabase-js has NO `auth.admin.createSession`. The supported server-side
    // pattern is: generate a magic-link token for the user, then redeem it with
    // verifyOtp() to get a real session (access + refresh token).
    const { data: authUser, error: authUserError } = await supabase.auth.admin.getUserById(userId);
    const sessionEmail = authUser?.user?.email;
    if (authUserError || !sessionEmail) {
      console.error("Failed to load auth user for session:", authUserError);
      return res.status(500).json({ error: "Failed to create session" });
    }

    const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
      type: "magiclink",
      email: sessionEmail,
    });
    const tokenHash = linkData?.properties?.hashed_token;
    if (linkError || !tokenHash) {
      console.error("Failed to generate login link:", linkError);
      return res.status(500).json({ error: "Failed to create session" });
    }

    const anon = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: otpData, error: otpError } = await anon.auth.verifyOtp({
      token_hash: tokenHash,
      type: "magiclink",
    });
    if (otpError || !otpData?.session) {
      console.error("Failed to verify login link:", otpError);
      return res.status(500).json({ error: "Failed to create session" });
    }

    return res.status(200).json({
      accessToken: otpData.session.access_token,
      refreshToken: otpData.session.refresh_token,
      redirectTo: `/channels/${partnerRow.channel_id}`,
    });
  } catch (error: any) {
    console.error("Partner auth error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
}
