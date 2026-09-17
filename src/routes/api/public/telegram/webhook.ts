import { createFileRoute } from "@tanstack/react-router";

/**
 * Telegram webhook receiver.
 *
 * Security: Telegram is configured with a `secret_token`, which it sends back
 * on every request as the `X-Telegram-Bot-Api-Secret-Token` header. Requests
 * without an exact match are rejected with 401 before any processing.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const Route = createFileRoute("/api/public/telegram/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env["TELEGRAM_WEBHOOK_SECRET"];
        const provided = request.headers.get(
          "x-telegram-bot-api-secret-token",
        );

        if (!expected || !provided || !timingSafeEqual(provided, expected)) {
          console.warn("[telegram] rejected update: bad or missing secret token");
          return new Response("Unauthorized", { status: 401 });
        }

        let update: Record<string, unknown>;
        try {
          update = await request.json();
        } catch {
          console.warn("[telegram] rejected update: invalid JSON body");
          return new Response("Bad Request", { status: 400 });
        }

        const updateId =
          typeof update["update_id"] === "number"
            ? (update["update_id"] as number)
            : null;
        const message = (update["message"] ?? update["edited_message"]) as
          | Record<string, any>
          | undefined;

        console.log(
          `[telegram] update ${updateId ?? "?"} from ${
            message?.from?.id ?? "unknown"
          }: ${message?.text ?? "(non-text update)"}`,
        );

        try {
          const { supabaseAdmin } = await import(
            "@/integrations/supabase/client.server"
          );
          await supabaseAdmin.from("telegram_updates").insert({
            update_id: updateId,
            telegram_user_id: message?.from?.id ?? null,
            chat_id: message?.chat?.id ?? null,
            text: message?.text ?? null,
            payload: update,
          });
        } catch (err) {
          console.error("[telegram] failed to persist update", err);
        }

        // Always 200 quickly so Telegram does not retry.
        return new Response("ok", { status: 200 });
      },
    },
  },
});
