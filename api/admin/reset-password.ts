import { createClient } from "@supabase/supabase-js";
import type { VercelRequest, VercelResponse } from "@vercel/node";

/**
 * Serverless function to reset a user's password using Supabase admin API.
 * 
 * Requires:
 * - SUPABASE_URL: Your Supabase project URL
 * - SUPABASE_SERVICE_ROLE_KEY: Supabase service role key (server-side only)
 * 
 * Caller must provide:
 * - Authorization header with Bearer token (user's session JWT)
 * - JSON body with userId
 * 
 * This function:
 * 1. Validates the caller has a valid session token
 * 2. Decodes the token to check if the user is an admin
 * 3. Generates a temporary password
 * 4. Updates the target user's password using the service role key
 * 5. Returns the temp password to the admin UI
 */

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  // Only accept POST requests
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  let body: any = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch (parseError) {
      console.warn("reset-password: body parse failed", parseError);
      return res.status(400).json({ error: "Invalid JSON body" });
    }
  }

  const { userId } = body ?? {};
  if (!userId || typeof userId !== "string") {
    return res.status(400).json({ error: "userId is required and must be a string" });
  }

  // Validate environment variables
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("Missing Supabase environment variables");
    console.error(
      "reset-password: env SUPABASE_URL=", !!process.env.SUPABASE_URL,
      "VITE_SUPABASE_URL=", !!process.env.VITE_SUPABASE_URL,
      "NEXT_PUBLIC_SUPABASE_URL=", !!process.env.NEXT_PUBLIC_SUPABASE_URL,
      "SUPABASE_SERVICE_ROLE_KEY=", !!process.env.SUPABASE_SERVICE_ROLE_KEY,
      "VITE_SUPABASE_SERVICE_ROLE_KEY=", !!process.env.VITE_SUPABASE_SERVICE_ROLE_KEY,
    );
    return res.status(500).json({ error: "Server misconfigured" });
  }

  // Extract Authorization header (Bearer token from client session)
  const authHeader = req.headers.authorization ?? (req.headers as any).Authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Not authenticated. Provide Authorization: Bearer <token>" });
  }

  const token = authHeader.slice(7); // Remove "Bearer " prefix

  try {
    // Create a client with the service role key to verify the token and perform admin actions
    const supabase = createClient(
      supabaseUrl,
      serviceRoleKey
    );

    // Verify the token and get the user's session
    const { data: sessionData, error: verifyError } = await supabase.auth.getUser(token);
    if (verifyError || !sessionData.user) {
      console.warn("Token verification failed:", verifyError);
      return res.status(401).json({ error: "Invalid or expired token" });
    }

    const adminUserId = sessionData.user.id;
    console.log(`Admin ${adminUserId} requesting password reset for user ${userId}`);

    // Authorization: only callers with an "owner" (or legacy "superadmin") role
    // in user_roles may reset another user's password.
    const { data: roleRow, error: roleError } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", adminUserId)
      .single();

    if (roleError) {
      console.warn("reset-password: role query failed:", roleError.message);
      return res.status(403).json({ error: `Role check failed: ${roleError.message}` });
    }

    if (!roleRow || typeof roleRow.role !== "string") {
      console.warn("reset-password: invalid role data:", roleRow);
      return res.status(403).json({ error: "Unauthorized: No valid role" });
    }

    const normalizedRole = (role: string | null | undefined): "owner" | "member" | "user" => {
      switch ((role ?? "").toLowerCase()) {
        case "owner":
        case "superadmin":
          return "owner";
        case "member":
        case "admin":
          return "member";
        default:
          return "user";
      }
    };

    if (normalizedRole(roleRow.role) !== "owner") {
      console.warn(`reset-password: forbidden, caller role is: ${roleRow.role}`);
      return res.status(403).json({ error: `Unauthorized: User role is ${roleRow.role}, only owner can perform this action` });
    }

    // Generate a temporary password
    const tempPassword = `TempPwd_${Math.random().toString(36).slice(2, 10).toUpperCase()}!`;

    // Update the target user's password using the service role key
    const { error: updateError } = await supabase.auth.admin.updateUserById(userId, {
      password: tempPassword,
    });

    if (updateError) {
      console.error("Password update error:", updateError);
      return res.status(400).json({
        error: `Failed to reset password: ${updateError.message}`,
      });
    }

    // Log this admin action
    console.log(`Password reset successful for user ${userId} by admin ${adminUserId}`);

    // Return the temp password to the admin UI
    return res.status(200).json({
      success: true,
      userId,
      tempPassword,
      message: "Password reset successfully. Provide this temporary password to the user.",
    });
  } catch (err: any) {
    console.error("Unexpected error in reset-password handler:", err);
    return res.status(500).json({
      error: err.message || "Internal server error",
    });
  }
}
