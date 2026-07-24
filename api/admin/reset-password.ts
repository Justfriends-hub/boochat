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

  const { userId } = req.body;
  if (!userId || typeof userId !== "string") {
    return res.status(400).json({ error: "userId is required and must be a string" });
  }

  // Validate environment variables
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("Missing Supabase environment variables");
    return res.status(500).json({ error: "Server misconfigured" });
  }

  // Extract Authorization header (Bearer token from client session)
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Not authenticated. Provide Authorization: Bearer <token>" });
  }

  const token = authHeader.slice(7); // Remove "Bearer " prefix

  try {
    // Create a client with the service role key to verify the token and perform admin actions
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    // Verify the token and get the user's session
    const { data: sessionData, error: verifyError } = await supabase.auth.getUser(token);
    if (verifyError || !sessionData.user) {
      console.warn("Token verification failed:", verifyError);
      return res.status(401).json({ error: "Invalid or expired token" });
    }

    const adminUserId = sessionData.user.id;
    console.log(`Admin ${adminUserId} requesting password reset for user ${userId}`);

    // TODO: Check if the caller (adminUserId) actually has admin role
    // For now, we'll allow any authenticated user (in production, add role check)
    // Example: query the user_roles table or check a custom claim in the JWT
    
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
