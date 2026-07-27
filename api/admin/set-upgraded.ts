import { createClient } from "@supabase/supabase-js";
import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { userId, upgraded } = req.body;
  if (!userId || typeof userId !== "string") {
    return res.status(400).json({ error: "userId is required and must be a string" });
  }
  if (typeof upgraded !== "boolean") {
    return res.status(400).json({ error: "upgraded is required and must be a boolean" });
  }

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("Missing Supabase server environment variables");
    return res.status(500).json({ error: "Server misconfigured" });
  }

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const token = authHeader.slice(7);
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  try {
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData?.user) {
      console.warn("set-upgraded: invalid token", userError);
      return res.status(401).json({ error: "Invalid or expired token" });
    }

    const adminUserId = userData.user.id;
    const { data: roleRow, error: roleError } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", adminUserId)
      .single();

    if (roleError || !roleRow || typeof roleRow.role !== "string") {
      console.warn("set-upgraded: admin role lookup failed", roleError);
      return res.status(403).json({ error: "Unauthorized" });
    }

    if (roleRow.role !== "owner") {
      return res.status(403).json({ error: "Only owner users can perform this action" });
    }

    const update: Record<string, any> = { is_upgraded: upgraded };
    if (upgraded) {
      update.upgraded_at = new Date().toISOString();
      update.upgraded_by = adminUserId;
    } else {
      update.upgraded_at = null;
      update.upgraded_by = null;
    }

    const { error: updateError } = await supabase
      .from("profiles")
      .update(update)
      .eq("id", userId);

    if (updateError) {
      console.error("set-upgraded: profile update failed", updateError);
      return res.status(400).json({ error: updateError.message });
    }

    return res.status(200).json({ success: true });
  } catch (err: any) {
    console.error("set-upgraded: unexpected error", err);
    return res.status(500).json({ error: err?.message || "Internal server error" });
  }
}
