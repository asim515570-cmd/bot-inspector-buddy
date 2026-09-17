import { setChatMenuButton, setMyCommands } from "./gateway.server";

/**
 * The command list shown in Telegram's "Menu" button.
 *
 * Customer commands are visible to everyone; admin commands are listed too so
 * admins can discover them, but every one of them re-checks the caller's role
 * in the database before doing anything.
 */
export const BOT_COMMANDS: { command: string; description: string }[] = [
  // customer
  { command: "start", description: "Open the store" },
  { command: "menu", description: "Main menu" },
  { command: "help", description: "How the store works" },
  { command: "orders", description: "My orders" },
  { command: "balance", description: "My wallet balance" },
  { command: "refer", description: "Referral link & earnings" },
  { command: "withdraw", description: "Request a payout" },
  { command: "pay", description: "Submit a payment reference" },
  { command: "support", description: "Contact support" },
  // admin
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

/** Pushes the command list to Telegram. Safe to call repeatedly. */
export async function registerBotCommands(): Promise<boolean> {
  const commandsReady = await setMyCommands(BOT_COMMANDS);
  if (!commandsReady) return false;
  return await setChatMenuButton();
}
