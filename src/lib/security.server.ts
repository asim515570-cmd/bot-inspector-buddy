/**
 * Server-side security primitives for the admin dashboard.
 *
 * Everything here runs with the service role and is never reachable from the
 * browser bundle (`.server.ts` files are excluded from client builds).
 *
 * Rules enforced:
 *  - Admin rights are re-read from the database on EVERY call. Nothing is
 *    cached, and nothing sent by the client is trusted.
 *  - Sensitive actions are rate limited in the database, so the limit holds
 *    across every stateless worker instance.
 *  - Database errors are never handed back to the browser verbatim; the real
 *    message stays in the server log.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type AuthContext = { userId: string; claims?: unknown };

export function actorOf(context: AuthContext): string {
  const claims = context.claims as { email?: string } | undefined;
  return claims?.email ?? context.userId;
}

/** Records an admin/security event. Never throws — auditing must not break the action. */
export async function logActivity(actor: string, action: string, detail?: string) {
  try {
    await supabaseAdmin
      .from("admin_activity")
      .insert({ actor, action, detail: detail ? detail.slice(0, 500) : null });
  } catch {
    /* ignore */
  }
}

/**
 * Database-backed rate limiter. Returns silently when allowed and throws a
 * user-safe error when the caller is over the limit.
 */
export async function rateLimit(
  key: string,
  opts: { limit?: number; windowSeconds?: number; cooldownSeconds?: number } = {},
) {
  const { data, error } = await supabaseAdmin.rpc("action_rate_check", {
    p_key: key.slice(0, 200),
    p_limit: opts.limit ?? 30,
    p_window_seconds: opts.windowSeconds ?? 60,
    p_cooldown_seconds: opts.cooldownSeconds ?? 120,
  });
  // Fail open on infrastructure errors so a hiccup never locks the owner out.
  if (error) {
    console.error(`[security] rate check failed for ${key}: ${error.message}`);
    return;
  }
  if (data === false) {
    console.warn(`[security] rate limited: ${key}`);
    throw new Error("Too many requests. Please wait a moment and try again.");
  }
}

/**
 * Verifies the caller is an administrator, reading the role fresh from the
 * database. Also applies a generous per-account request ceiling so a stolen
 * session cannot be used to scrape the dashboard at machine speed.
 */
export async function assertAdmin(context: AuthContext): Promise<void> {
  const userId = context.userId;
  if (!userId || typeof userId !== "string") throw new Error("Not authorized.");

  await rateLimit(`api:${userId}`, { limit: 300, windowSeconds: 60, cooldownSeconds: 60 });

  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();

  if (error) {
    console.error(`[security] role lookup failed: ${error.message}`);
    throw new Error("Could not verify your permissions. Please try again.");
  }
  if (!data) {
    console.warn(`[security] admin action denied for user ${userId}`);
    await logActivity(actorOf(context), "auth:denied", "non-admin attempted an admin action");
    throw new Error("Not authorized. This account is not an administrator.");
  }
}

/** Admin check plus a tighter limit for state-changing actions. */
export async function assertAdminAction(
  context: AuthContext,
  action: string,
  opts: { limit?: number; windowSeconds?: number } = {},
): Promise<void> {
  await assertAdmin(context);
  await rateLimit(`${action}:${context.userId}`, {
    limit: opts.limit ?? 30,
    windowSeconds: opts.windowSeconds ?? 60,
    cooldownSeconds: 120,
  });
}

/**
 * Converts a database error into a safe, user-facing error. Table names,
 * SQL fragments and driver details stay in the server log only.
 */
export function dbFail(error: unknown, friendly = "Something went wrong. Please try again."): Error {
  const message =
    error && typeof error === "object" && "message" in error
      ? String((error as { message: unknown }).message)
      : String(error);
  console.error(`[db] ${message}`);
  return new Error(friendly);
}
