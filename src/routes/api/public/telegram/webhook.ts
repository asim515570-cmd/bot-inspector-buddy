import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "@/lib/telegram/validation";

/**
 * Telegram webhook receiver.
 *
 * Security: Telegram is configured with a `secret_token`, which it sends back
 * on every request as the `X-Telegram-Bot-Api-Secret-Token` header. Requests
 * without an exact match are rejected with 401 before any processing.
 */

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
        type TgMessage = {
          from?: { id?: number };
          chat?: { id?: number };
          text?: string;
        };
        const message = (update["message"] ?? update["edited_message"]) as
          | TgMessage
          | undefined;

        console.log(
          `[telegram] update ${updateId ?? "?"} from ${
            message?.from?.id ?? "unknown"
          }: ${message?.text ?? "(non-text update)"}`,
        );

        // Replay / duplicate protection: `update_id` is unique in the database,
        // so a repeated (or replayed) update is recorded once and processed once.
        let alreadySeen = false;
        try {
          const { supabaseAdmin } = await import(
            "@/integrations/supabase/client.server"
          );
          const { error } = await supabaseAdmin.from("telegram_updates").insert({
            update_id: updateId,
            telegram_user_id: message?.from?.id ?? null,
            chat_id: message?.chat?.id ?? null,
            text: message?.text ?? null,
            payload: update as Record<string, unknown> as never,
          });
          if (error?.code === "23505") {
            alreadySeen = true;
            console.warn(`[telegram] duplicate update ${updateId ?? "?"} ignored`);
          } else if (error) {
            console.error(`[telegram] failed to persist update: ${error.message}`);
          }
        } catch (err) {
          console.error("[telegram] failed to persist update", err);
        }

        if (!alreadySeen) {
          try {
            const { handleUpdate } = await import("@/lib/telegram/bot.server");
            await handleUpdate(update as never);
          } catch (err) {
            console.error("[telegram] handler error", err);
          }
        }

        // Always 200 quickly so Telegram does not retry.
        return new Response("ok", { status: 200 });
      },
    },
  },
});
