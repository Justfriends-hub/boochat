import { createClient } from "@supabase/supabase-js";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import crypto from "crypto";

/**
 * POST /api/partner/auth
 * 
 * Partner sign-in endpoint. Verifies signed JWT, creates/links user, joins channel.
 * Returns session token + redirect URL to the channel.
 * 
 * Environment variables required:
 * - SUPABASE_URL
 * - SUPABASE_SERVICE_ROLE_KEY
 * 
 * Request body:
 * {
 *   "partner": "moneymate9ja",
 *   "token": "<HS256 JWT>"
 * }
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
    const payload = JSON.parse(Buffer.from(payloadB64, "base64").toString());

    // Verify signature
    const message = `${headerB64}.${payloadB64}`;
    const computed = crypto.createHmac("sha256", secret).update(message).digest("hex");
    const provided = Buffer.from(signatureB64, "base64").toString("hex");

    if (!constantTimeCompare(computed, provided)) {
      return null;
    }

    return payload as PartnerJWT;
  } catch {
    return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  const { partner: partnerSlug, token: jwtToken } = body ?? {};

  if (!partnerSlug || typeof partnerSlug !== "string") {
    return res.status(400).json({ error: "partner slug required" });
  }
  if (!jwtToken || typeof jwtToken !== "string") {
    return res.status(400).json({ error: "token required" });
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.error("Missing Supabase env config");
    return res.status(500).json({ error: "Server misconfiguration" });
  }

  try {
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // 1. Look up partner
    const { data: partnerRow, error: partnerError } = await supabase
      .from("partner_sources")
      .select("id, name, channel_id, shared_secret, active")
      .eq("slug", partnerSlug)
      .single();

    if (partnerError || !partnerRow) {
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

    // 3. Check exp
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now) {
      return res.status(401).json({ error: "Token expired" });
    }

    // 4. Replay protection: check nonce
    const { data: nonceRow, error: nonceError } = await supabase
      .from("partner_auth_nonces")
      .select("id")
      .eq("partner_id", partnerRow.id)
      .eq("nonce", payload.nonce)
      .single();

    if (!nonceError && nonceRow) {
      // Nonce was already used
      return res.status(401).json({ error: "Token already redeemed" });
    }

    // Store nonce to mark as used
    const expiresAt = new Date((payload.exp + 3600) * 1000).toISOString(); // +1hr grace
    await supabase.from("partner_auth_nonces").insert({
      partner_id: partnerRow.id,
      nonce: payload.nonce,
      expires_at: expiresAt,
    });

    // 5. Find or create user
    // First, check if this partner+ext_user_id is already linked
    const { data: extIdRow } = await supabase
      .from("external_identities")
      .select("user_id")
      .eq("partner_id", partnerRow.id)
      .eq("external_user_id", payload.ext_user_id)
      .single();

    let userId: string;

    if (extIdRow) {
      // Already linked
      userId = extIdRow.user_id;
    } else {
      // Try to find by email
      const { data: profileRow } = await supabase
        .from("profiles")
        .select("id")
        .eq("email", payload.email)
        .single();

      if (profileRow) {
        // Email exists — link to existing user
        userId = profileRow.id;
      } else {
        // Create new user via admin API
        const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
          email: payload.email,
          email_confirm: true,
          password: crypto.randomBytes(32).toString("hex"),
          user_metadata: {
            display_name: payload.name,
          },
        });

        if (createError || !newUser.user) {
          console.error("Failed to create user:", createError);
          return res.status(500).json({ error: "Failed to create account" });
        }

        userId = newUser.user.id;

        // Create profile
        await supabase.from("profiles").insert({
          id: userId,
          email: payload.email,
          display_name: payload.name,
          avatar_url: null,
        });
      }
    }

    // 6. Check if user is banned
    const { data: profile } = await supabase
      .from("profiles")
      .select("banned")
      .eq("id", userId)
      .single();

    if (profile?.banned) {
      return res.status(403).json({ error: "Account is banned" });
    }

    // 7. Check if user was removed from this channel
    const { data: removedRow } = await supabase
      .from("removed_channel_members")
      .select("id")
      .eq("channel_id", partnerRow.channel_id)
      .eq("user_id", userId)
      .single();

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
      external_user_id: payload.ext_user_id,
      user_id: userId,
      email: payload.email,
    });

    // 10. Enqueue member_joined event (for webhook worker)
    await supabase.from("partner_webhook_outbox").insert({
      partner_id: partnerRow.id,
      event_id: `joined:${partnerRow.id}:${payload.ext_user_id}`,
      batch_no: 0,
      payload: {
        event_id: `joined:${partnerRow.id}:${payload.ext_user_id}`,
        type: "member_joined",
        partner: partnerSlug,
        channel_id: partnerRow.channel_id,
        channel_name: "string", // Will be fetched by worker
        recipients: [payload.ext_user_id],
      },
    });

    // 11. Create session
    const { data: session, error: sessionError } = await supabase.auth.admin.createSession(userId);

    if (sessionError || !session) {
      console.error("Failed to create session:", sessionError);
      return res.status(500).json({ error: "Failed to create session" });
    }

    return res.status(200).json({
      accessToken: session.session.access_token,
      refreshToken: session.session.refresh_token,
      redirectTo: `/channels/${partnerRow.channel_id}`,
    });
  } catch (error: any) {
    console.error("Partner auth error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
}
