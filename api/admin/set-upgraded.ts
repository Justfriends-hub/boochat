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
    console.error("Missing Supabase server environment variables. SUPABASE_URL:", !!process.env.SUPABASE_URL, "SUPABASE_SERVICE_ROLE_KEY:", !!process.env.SUPABASE_SERVICE_ROLE_KEY);
    return res.status(500).json({ error: "Server misconfigured: Missing Supabase credentials" });
  }

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const token = authHeader.slice(7);
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  try {
    console.log("set-upgraded: verifying token for user");
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData?.user) {
      console.warn("set-upgraded: token verification failed", userError?.message);
      return res.status(401).json({ error: "Invalid or expired token" });
    }

    const adminUserId = userData.user.id;
    console.log("set-upgraded: checking admin role for", adminUserId);
    
    const { data: roleRow, error: roleError } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", adminUserId)
      .single();

    if (roleError) {
      console.warn("set-upgraded: role query failed:", roleError.message);
      return res.status(403).json({ error: `Role check failed: ${roleError.message}` });
    }

    if (!roleRow || typeof roleRow.role !== "string") {
      console.warn("set-upgraded: invalid role data:", roleRow);
      return res.status(403).json({ error: "Unauthorized: No valid role" });
    }

    if (roleRow.role !== "owner") {
      console.warn("set-upgraded: user is not owner, role is:", roleRow.role);
      return res.status(403).json({ error: `Unauthorized: User role is ${roleRow.role}, only owner can perform this action` });
    }

    console.log("set-upgraded: updating user", userId, "to upgraded:", upgraded);
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
      console.error("set-upgraded: profile update failed:", updateError.message, updateError.details);
      return res.status(400).json({ error: `Profile update failed: ${updateError.message}` });
    }

    console.log("set-upgraded: success for user", userId);
    return res.status(200).json({ success: true });
  } catch (err: any) {
    console.error("set-upgraded: unexpected error:", err?.message || err);
    return res.status(500).json({ error: `Unexpected error: ${err?.message || "Internal server error"}` });
  }
}
