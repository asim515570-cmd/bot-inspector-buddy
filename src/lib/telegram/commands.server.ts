import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { deleteMyCommands, setChatMenuButton, setMyCommands } from "./gateway.server";

/**
 * The command list shown in Telegram's "Menu" button.
 *
 * Customer commands are visible to everyone; admin commands are listed too so
 * admins can discover them, but every one of them re-checks the caller's role
 * in the database before doing anything.
 */
export const CUSTOMER_COMMANDS: { command: string; description: string }[] = [
  { command: "start", description: "Open the store" },
  { command: "menu", description: "Main menu" },
  { command: "help", description: "How the store works" },
];

export const ADMIN_COMMANDS: { command: string; description: string }[] = [
  ...CUSTOMER_COMMANDS,
  { command: "admin", description: "Admin: all admin commands" },
  { command: "products", description: "Admin: list products" },
  { command: "addproduct", description: "Admin: slug|Name|emoji|price" },
  { command: "setprice", description: "Admin: set product price" },
  { command: "flashsale", description: "Admin: slug price hours" },
  { command: "flashsales", description: "Admin: running flash sales" },
  { command: "stopflashsale", description: "Admin: stop a flash sale" },
  { command: "setactive", description: "Admin: show/hide a product" },
  { command: "setdesc", description: "Admin: set description" },
  { command: "setemoji", description: "Admin: set emoji" },
  { command: "addstock", description: "Admin: add stock codes" },
  { command: "stock", description: "Admin: stock counts" },
  { command: "clearstock", description: "Admin: clear available stock" },
  { command: "delproduct", description: "Admin: delete a product" },
  { command: "payments", description: "Admin: pending payments" },
  { command: "approve_pay", description: "Admin: approve a payment" },
  { command: "redeliver_pay", description: "Admin: re-send delivered items" },
  { command: "reject_pay", description: "Admin: reject a payment" },
  { command: "withdrawals", description: "Admin: payout requests" },
  { command: "approve_wd", description: "Admin: approve a payout" },
  { command: "reject_wd", description: "Admin: reject a payout" },
  { command: "whois", description: "Admin: look up a customer" },
  { command: "credit", description: "Admin: add balance" },
  { command: "debit", description: "Admin: remove balance" },
  { command: "ban", description: "Admin: block a customer" },
  { command: "unban", description: "Admin: unblock a customer" },
  { command: "broadcast", description: "Admin: message all customers" },
  { command: "backup", description: "Admin: data snapshot" },
];

/** Applies or removes a private, chat-specific admin command menu. */
export async function syncUserCommandScope(
  telegramId: number,
  role: "admin" | "customer",
): Promise<boolean> {
  const scope = { type: "chat" as const, chat_id: telegramId };
  if (role === "admin") return await setMyCommands(ADMIN_COMMANDS, scope);
  return await deleteMyCommands(scope);
}

/** Publishes three customer commands globally and admin commands only to current admins. */
export async function registerBotCommands(): Promise<boolean> {
  const defaultReady = await setMyCommands(CUSTOMER_COMMANDS, { type: "default" });
  const privateReady = await setMyCommands(CUSTOMER_COMMANDS, { type: "all_private_chats" });
  if (!defaultReady || !privateReady) return false;

  const { data: users, error } = await supabaseAdmin
    .from("bot_users")
    .select("telegram_id, role");
  if (error) {
    console.error(`[telegram] command scope lookup failed: ${error.message}`);
    return false;
  }

  for (const user of users ?? []) {
    const ready = await syncUserCommandScope(
      Number(user.telegram_id),
      user.role === "admin" ? "admin" : "customer",
    );
    if (!ready) return false;
  }

  return await setChatMenuButton();
}
