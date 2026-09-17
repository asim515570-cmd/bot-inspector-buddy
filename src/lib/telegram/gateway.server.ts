/**
 * Telegram Bot API access through the Lovable connector gateway.
 *
 * The bot token lives in the managed Telegram connector — it is never read,
 * stored, or logged by this code. Every call is authorized with the project
 * API key plus the connection key, both server-only env vars.
 */
const GATEWAY_URL = "https://connector-gateway.lovable.dev/telegram";

async function callTelegram(
  method: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  const lovableApiKey = process.env["LOVABLE_API_KEY"];
  const telegramApiKey = process.env["TELEGRAM_API_KEY"];

  if (!lovableApiKey || !telegramApiKey) {
    console.error(`[telegram] ${method} skipped: gateway not configured`);
    return null;
  }

  try {
    const res = await fetch(`${GATEWAY_URL}/${method}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableApiKey}`,
        "X-Connection-Api-Key": telegramApiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as { ok?: boolean; description?: string };
    if (!json?.ok) {
      console.warn(`[telegram] ${method} failed: ${json?.description ?? "unknown"}`);
    }
    return json;
  } catch (err) {
    console.error(`[telegram] ${method} threw`, err);
    return null;
  }
}

export type InlineButton = { text: string; callback_data: string };

export async function sendMessage(
  chatId: number,
  text: string,
  keyboard?: InlineButton[][],
): Promise<void> {
  console.log(`[telegram] -> chat ${chatId}: ${text.replace(/\n/g, " | ")}`);
  await callTelegram("sendMessage", {
    chat_id: chatId,
    text,
    ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
  });
}

export async function answerCallbackQuery(
  callbackQueryId: string,
  text?: string,
): Promise<void> {
  await callTelegram("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    ...(text ? { text } : {}),
  });
}
