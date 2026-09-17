/**
 * Per-user flood protection for the bot.
 *
 * Counting happens in the database (the worker runtime is stateless), so the
 * limit holds across every request and every instance. A user who goes over
 * the limit is put on a short cooldown; nothing is cached in memory.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const LIMIT = 20; // messages/taps
const WINDOW = 10; // seconds
const COOLDOWN = 30; // seconds of silence after flooding

export async function allowRequest(telegramId: number): Promise<boolean> {
  const { data, error } = await supabaseAdmin.rpc("bot_rate_check", {
    p_telegram_id: telegramId,
    p_limit: LIMIT,
    p_window_seconds: WINDOW,
    p_cooldown_seconds: COOLDOWN,
  });
  if (error) {
    // Never lock users out because of an infrastructure hiccup.
    console.error(`[telegram] rate check failed: ${error.message}`);
    return true;
  }
  if (data === false) {
    console.warn(`[telegram] rate limited telegram_id=${telegramId}`);
    return false;
  }
  return true;
}
