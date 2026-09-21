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
    const responseText = await res.text();
    let json: { ok?: boolean; description?: string; error?: string; message?: string; type?: string };
    try {
      json = JSON.parse(responseText) as typeof json;
    } catch {
      console.error(
        `[telegram] ${method} failed [${res.status}]: ${responseText.slice(0, 500) || "empty response"}`,
      );
      return null;
    }
    if (!res.ok || !json.ok) {
      const detail = json.description ?? json.error ?? json.message ?? json.type ?? responseText;
      console.error(`[telegram] ${method} failed [${res.status}]: ${detail}`);
    }
    return json;
  } catch (err) {
    console.error(`[telegram] ${method} threw`, err);
    return null;
  }
}

export type InlineButton = {
  text: string;
  callback_data?: string;
  url?: string;
  style?: "primary" | "success" | "danger";
};

export async function sendMessage(
  chatId: number,
  text: string,
  keyboard?: InlineButton[][],
  html = false,
): Promise<number | null> {
  console.log(`[telegram] -> chat ${chatId}: ${text.replace(/\n/g, " | ")}`);
  const res = (await callTelegram("sendMessage", {
    chat_id: chatId,
    text,
    ...(html ? { parse_mode: "HTML", link_preview_options: { is_disabled: true } } : {}),
    ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
  })) as { result?: { message_id?: number } } | null;
  return res?.result?.message_id ?? null;
}

/** Edits an existing bot message in place (single-message navigation UI). */
export async function editMessageText(
  chatId: number,
  messageId: number,
  text: string,
  keyboard?: InlineButton[][],
  html = false,
): Promise<boolean> {
  const res = (await callTelegram("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    ...(html ? { parse_mode: "HTML", link_preview_options: { is_disabled: true } } : {}),
    ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
  })) as { ok?: boolean } | null;
  return Boolean(res?.ok);
}

/** Registers the command list shown in the Telegram "Menu" button. */
export async function setMyCommands(
  commands: { command: string; description: string }[],
  scope?: { type: "default" | "all_private_chats" | "all_group_chats" | "chat"; chat_id?: number },
): Promise<boolean> {
  const res = (await callTelegram("setMyCommands", {
    commands,
    ...(scope ? { scope } : {}),
  })) as { ok?: boolean } | null;
  return Boolean(res?.ok);
}

export async function deleteMyCommands(
  scope: { type: "chat"; chat_id: number },
): Promise<boolean> {
  const res = (await callTelegram("deleteMyCommands", { scope })) as { ok?: boolean } | null;
  return Boolean(res?.ok);
}

/** Keeps Telegram's permanent Menu button visible beside the message field. */
export async function setChatMenuButton(): Promise<boolean> {
  const res = (await callTelegram("setChatMenuButton", {
    menu_button: { type: "commands" },
  })) as { ok?: boolean } | null;
  return Boolean(res?.ok);
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

/** Raw Bot API call for read-only diagnostics (getMe, getWebhookInfo). */
export async function telegramInfo(method: string): Promise<unknown> {
  return callTelegram(method, {});
}

const BROADCAST_BATCH_SIZE = 25;
const BROADCAST_BATCH_DELAY_MS = 900; // ~28 msg/s, under Telegram's ~30 msg/s broadcast limit
export const BROADCAST_MAX_RECIPIENTS = 2000;

/**
 * Sends the same text to many chats in small concurrent batches instead of
 * one message at a time. A single unreachable/blocked chat never stops the
 * rest — failures are swallowed per-recipient and simply not counted as sent.
 */
export async function broadcastMessage(chatIds: number[], text: string): Promise<number> {
  let sent = 0;
  const capped = chatIds.slice(0, BROADCAST_MAX_RECIPIENTS);
  for (let i = 0; i < capped.length; i += BROADCAST_BATCH_SIZE) {
    const batch = capped.slice(i, i + BROADCAST_BATCH_SIZE);
    const results = await Promise.allSettled(batch.map((chatId) => sendMessage(chatId, text)));
    for (const r of results) {
      if (r.status === "fulfilled" && r.value !== null) sent += 1;
    }
    if (i + BROADCAST_BATCH_SIZE < capped.length) {
      await new Promise((resolve) => setTimeout(resolve, BROADCAST_BATCH_DELAY_MS));
    }
  }
  return sent;
}
