import { createFileRoute } from "@tanstack/react-router";

/**
 * One-shot webhook registration helper.
 *
 * The bot token now lives in the managed Telegram connector, so this endpoint
 * never touches a raw token. It registers the webhook through the Lovable
 * connector gateway using the linked connection key + project API key.
 *
 * Authorization: callers must send `x-admin-token` matching the project's
 * `LOVABLE_CRON_SECRET`, so a stranger who discovers the public URL cannot
 * repoint the bot's webhook.
 */
const GATEWAY_URL = "https://connector-gateway.lovable.dev/telegram";

export const Route = createFileRoute("/api/public/telegram/register")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const lovableApiKey = process.env["LOVABLE_API_KEY"];
        const telegramApiKey = process.env["TELEGRAM_API_KEY"];
        const webhookSecret = process.env["TELEGRAM_WEBHOOK_SECRET"];
        const adminSecret = process.env["LOVABLE_CRON_SECRET"];

        const provided = request.headers.get("x-admin-token");

        if (!adminSecret || !provided || provided !== adminSecret) {
          return new Response("Unauthorized", { status: 401 });
        }

        if (!lovableApiKey || !telegramApiKey || !webhookSecret) {
          return Response.json(
            {
              ok: false,
              error:
                "Gateway credentials or webhook secret is not configured.",
            },
            { status: 500 },
          );
        }

        const url = new URL(request.url);
        const webhookUrl = `${url.origin}/api/public/telegram/webhook`;

        const res = await fetch(`${GATEWAY_URL}/setWebhook`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${lovableApiKey}`,
            "X-Connection-Api-Key": telegramApiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            url: webhookUrl,
            secret_token: webhookSecret,
            allowed_updates: ["message", "edited_message", "callback_query"],
            drop_pending_updates: true,
          }),
        });

        const result = await res.json();

        // Also refresh the command list shown in the Telegram "Menu" button.
        const { registerBotCommands } = await import("@/lib/telegram/commands.server");
        const commands = await registerBotCommands();

        return Response.json({ webhookUrl, telegram: result, commands });
      },
    },
  },
});
