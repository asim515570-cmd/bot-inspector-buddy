import { createFileRoute } from "@tanstack/react-router";

/**
 * One-shot webhook registration helper.
 *
 * The webhook secret is stored encrypted and is never revealed, so this
 * endpoint performs the Telegram `setWebhook` call server-side. The caller
 * must prove ownership by sending the bot token in the `x-bot-token` header.
 */
export const Route = createFileRoute("/api/public/telegram/register")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = process.env["TELEGRAM_BOT_TOKEN"];
        const secret = process.env["TELEGRAM_WEBHOOK_SECRET"];
        const provided = request.headers.get("x-bot-token");

        if (!token || !secret) {
          return Response.json(
            { ok: false, error: "Bot token or webhook secret is not configured." },
            { status: 500 },
          );
        }
        if (provided !== token) {
          return new Response("Unauthorized", { status: 401 });
        }

        const url = new URL(request.url);
        const webhookUrl = `${url.origin}/api/public/telegram/webhook`;

        const res = await fetch(
          `https://api.telegram.org/bot${token}/setWebhook`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              url: webhookUrl,
              secret_token: secret,
              allowed_updates: ["message", "edited_message", "callback_query"],
              drop_pending_updates: true,
            }),
          },
        );

        const result = await res.json();
        return Response.json({ webhookUrl, telegram: result });
      },
    },
  },
});
