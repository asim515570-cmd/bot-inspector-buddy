/**
 * Operations layer for the Telegram bot:
 *  - customer wallet/referral/payment commands
 *  - the in-Telegram admin control panel (orders, payments, payouts, users)
 *
 * Admin authorization is re-read from the database on every single call by the
 * caller in bot.server.ts; nothing here trusts client-supplied roles.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendMessage, type InlineButton } from "./gateway.server";
import { formatPrice, parsePrice } from "./validation";
import { render, setting, type View } from "./storefront.server";

export type OpsUser = { id: string; telegram_id: number };

const short = (id: string) => id.slice(0, 8);

async function numSetting(key: string, fallback: number): Promise<number> {
  const raw = await setting(key, String(fallback));
  const num = Number(raw);
  return Number.isFinite(num) ? num : fallback;
}

// ------------------------------------------------------------- customer side

export async function referralScreen(view: View, user: OpsUser, botUsernameHint = "") {
  const botUsername = botUsernameHint || (await setting("bot_username", ""));
  const [{ data: me }, { count: invited }, percent] = await Promise.all([
    supabaseAdmin
      .from("bot_users")
      .select("referral_code, referral_earned")
      .eq("id", user.id)
      .maybeSingle(),
    supabaseAdmin
      .from("bot_users")
      .select("id", { count: "exact", head: true })
      .eq("referred_by", user.id),
    numSetting("referral_percent", 5),
  ]);

  const code = me?.referral_code ?? "-";
  const link = botUsername ? `https://t.me/${botUsername}?start=${code}` : `code: ${code}`;
  await render(
    view,
    [
      "🤝 <b>Refer &amp; earn</b>",
      "",
      `You earn <b>${percent}%</b> of every purchase made by the people you invite.`,
      "",
      `🔗 Your link: <code>${link}</code>`,
      `🏷 Your code: <code>${code}</code>`,
      "",
      `👥 Invited: <b>${invited ?? 0}</b>`,
      `💵 Earned so far: <b>${formatPrice(Number(me?.referral_earned ?? 0))}</b>`,
      "",
      "<i>Commission is added to your balance the moment a referred order is delivered.</i>",
    ].join("\n"),
    [
      [{ text: "💰 Balance", callback_data: "balance" }],
      [{ text: "🏠 Menu", callback_data: "menu" }],
    ],
  );
}

export async function withdrawScreen(view: View, user: OpsUser) {
  const [{ data: me }, min, methods, { data: rows }] = await Promise.all([
    supabaseAdmin.from("bot_users").select("balance").eq("id", user.id).maybeSingle(),
    numSetting("min_withdrawal", 10),
    setting("withdrawal_methods", "USDT TRC20, Binance Pay"),
    supabaseAdmin
      .from("withdrawals")
      .select("id, amount, method, status, created_at")
      .eq("bot_user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  const lines = [
    "🏦 <b>Withdraw your balance</b>",
    "",
    `Available: <b>${formatPrice(Number(me?.balance ?? 0))}</b>`,
    `Minimum payout: <b>${formatPrice(min)}</b>`,
    `Methods: ${methods}`,
    "",
    "To request a payout send:",
    "<code>/withdraw 25 USDT TRC20 TXyzAddress...</code>",
    "<i>(amount, then method, then your payout address)</i>",
  ];
  if ((rows ?? []).length) {
    lines.push("", "<b>Your requests</b>");
    for (const w of rows ?? []) {
      const icon = w.status === "approved" ? "✅" : w.status === "rejected" ? "❌" : "⏳";
      lines.push(`${icon} ${formatPrice(w.amount as number)} · ${w.method} · ${w.status}`);
    }
  }
  await render(view, lines.join("\n"), [
    [{ text: "🤝 Refer & earn", callback_data: "refer" }],
    [{ text: "🏠 Menu", callback_data: "menu" }],
  ]);
}

/** /withdraw <amount> <method words...> <address> */
export async function requestWithdrawal(chatId: number, user: OpsUser, rest: string) {
  const parts = rest.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 3) {
    await sendMessage(
      chatId,
      "Usage: /withdraw <amount> <method> <address>\nExample: /withdraw 25 USDT TRC20 TXyz...",
    );
    return;
  }
  const amount = parsePrice(parts[0] ?? "");
  if (amount === null) {
    await sendMessage(chatId, "❌ Amount must be a positive number, e.g. 25 or 25.50.");
    return;
  }
  const min = await numSetting("min_withdrawal", 10);
  if (amount < min) {
    await sendMessage(chatId, `❌ Minimum payout is ${formatPrice(min)}.`);
    return;
  }
  const address = parts[parts.length - 1] ?? "";
  const method = parts.slice(1, -1).join(" ");
  if (address.length < 6 || address.length > 200) {
    await sendMessage(chatId, "❌ That payout address does not look valid.");
    return;
  }

  const { error } = await supabaseAdmin.rpc("request_withdrawal", {
    p_bot_user: user.id,
    p_amount: amount,
    p_method: method,
    p_address: address,
  });
  if (error) {
    await sendMessage(
      chatId,
      error.message.includes("insufficient_balance")
        ? "❌ Your balance is not enough for that payout."
        : "❌ Could not create the payout request.",
    );
    return;
  }
  await sendMessage(
    chatId,
    `🏦 Payout request received: ${formatPrice(amount)} via ${method}.\nThe amount is on hold and an admin will review it shortly.`,
  );
  await notifyAdmins(
    `🏦 New payout request: ${formatPrice(amount)} via ${method} from user ${user.telegram_id}. Review with /withdrawals`,
  );
}

/** /pay <order id prefix> <transaction reference> */
export async function submitPayment(chatId: number, user: OpsUser, rest: string) {
  const [orderRef, ...txParts] = rest.trim().split(/\s+/).filter(Boolean);
  const reference = txParts.join(" ");
  if (!orderRef || reference.length < 4) {
    await sendMessage(
      chatId,
      "Usage: /pay <order id> <transaction reference>\nExample: /pay 16a696fd 0x9f3c...",
    );
    return;
  }
  if (reference.length > 120) {
    await sendMessage(chatId, "❌ That transaction reference is too long.");
    return;
  }

  const { data: orders } = await supabaseAdmin
    .from("orders")
    .select("id, status, total_price, products(name)")
    .eq("bot_user_id", user.id)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(20);

  const order = (orders ?? []).find((o) => String(o.id).startsWith(orderRef.toLowerCase()));
  if (!order) {
    await sendMessage(chatId, "❌ No pending order found with that id. Check /orders.");
    return;
  }

  const { error } = await supabaseAdmin
    .from("orders")
    .update({ payment_reference: reference, payment_method: "manual" })
    .eq("id", order.id);
  if (error) {
    await sendMessage(
      chatId,
      error.code === "23505"
        ? "❌ That transaction reference was already used for another order."
        : "❌ Could not save your payment reference.",
    );
    return;
  }

  const name = (order as { products: { name: string } | null }).products?.name ?? "your order";
  await sendMessage(
    chatId,
    `🧾 Payment reference saved for ${name} (${short(String(order.id))}).\nAn admin will confirm it shortly and your item will be delivered here.`,
  );
  await notifyAdmins(
    `💳 Payment submitted: order ${short(String(order.id))} · ${formatPrice(order.total_price as number)} · ref ${reference}. Review with /payments`,
  );
}

/** Messages every admin in bot_users (used for new payments and payouts). */
async function notifyAdmins(text: string) {
  const { data } = await supabaseAdmin
    .from("bot_users")
    .select("telegram_id")
    .eq("role", "admin")
    .eq("is_blocked", false)
    .limit(20);
  for (const a of data ?? []) await sendMessage(a.telegram_id, text);
}

// ---------------------------------------------------------------- admin side

export const OPS_COMMANDS = new Set([
  "/panel",
  "/payments",
  "/withdrawals",
  "/approve_pay",
  "/reject_pay",
  "/approve_wd",
  "/reject_wd",
  "/credit",
  "/debit",
  "/whois",
  "/ban",
  "/unban",
  "/stats",
  "/broadcast",
]);

async function findUserByTelegramId(tid: number) {
  const { data } = await supabaseAdmin
    .from("bot_users")
    .select("id, telegram_id, username, first_name, balance, role, is_blocked, referral_earned")
    .eq("telegram_id", tid)
    .maybeSingle();
  return data;
}

async function adjustBalance(
  chatId: number,
  rest: string,
  sign: 1 | -1,
) {
  const parts = rest.trim().split(/\s+/).filter(Boolean);
  const tid = Number(parts[0]);
  const amount = parsePrice(parts[1] ?? "");
  if (!Number.isSafeInteger(tid) || tid <= 0 || amount === null) {
    await sendMessage(
      chatId,
      `Usage: ${sign > 0 ? "/credit" : "/debit"} <telegram id> <amount> [reason]`,
    );
    return;
  }
  const target = await findUserByTelegramId(tid);
  if (!target) return void (await sendMessage(chatId, "❌ No customer with that Telegram id."));

  const delta = sign * amount;
  const next = Number(target.balance) + delta;
  if (next < 0) return void (await sendMessage(chatId, "❌ That would make the balance negative."));

  const reason = parts.slice(2).join(" ") || (sign > 0 ? "Admin top-up" : "Admin adjustment");
  await supabaseAdmin.from("bot_users").update({ balance: next }).eq("id", target.id);
  await supabaseAdmin.from("wallet_transactions").insert({
    bot_user_id: target.id,
    amount: delta,
    balance_after: next,
    reason,
  });
  await sendMessage(
    chatId,
    `✅ ${sign > 0 ? "Credited" : "Debited"} ${formatPrice(amount)}. New balance for ${tid}: ${formatPrice(next)}`,
  );
  await sendMessage(
    tid,
    `${sign > 0 ? "➕" : "➖"} ${formatPrice(amount)} ${sign > 0 ? "added to" : "removed from"} your balance (${reason}).\nNew balance: ${formatPrice(next)}`,
  );
}

/** Handles an admin ops command. Caller has already verified the admin role. */
export async function handleOpsCommand(
  command: string,
  rest: string,
  chatId: number,
): Promise<void> {
  switch (command) {
    case "/panel":
    case "/stats": {
      const [{ data: orders }, { data: users }, { count: pendingWd }, { data: stock }] =
        await Promise.all([
          supabaseAdmin.from("orders").select("status, total_price"),
          supabaseAdmin.from("bot_users").select("id, is_blocked"),
          supabaseAdmin
            .from("withdrawals")
            .select("id", { count: "exact", head: true })
            .eq("status", "pending"),
          supabaseAdmin.from("stock_items").select("status"),
        ]);
      const o = orders ?? [];
      const revenue = o
        .filter((r) => r.status === "delivered" || r.status === "paid")
        .reduce((sum, r) => sum + Number(r.total_price ?? 0), 0);
      await sendMessage(
        chatId,
        [
          "🛠 Admin panel",
          "",
          `Customers: ${(users ?? []).length} (blocked: ${(users ?? []).filter((u) => u.is_blocked).length})`,
          `Orders: ${o.length} · pending ${o.filter((r) => r.status === "pending").length} · paid ${o.filter((r) => r.status === "paid").length} · delivered ${o.filter((r) => r.status === "delivered").length}`,
          `Revenue: ${formatPrice(revenue)}`,
          `Stock available: ${(stock ?? []).filter((s) => s.status === "available").length}`,
          `Payout requests waiting: ${pendingWd ?? 0}`,
          "",
          "/payments — confirm payments",
          "/withdrawals — review payouts",
          "/credit <id> <amt> · /debit <id> <amt>",
          "/whois <id> · /ban <id> · /unban <id>",
          "/broadcast <message>",
        ].join("\n"),
      );
      return;
    }

    case "/payments": {
      const { data } = await supabaseAdmin
        .from("orders")
        .select("id, total_price, payment_reference, created_at, products(name), bot_users(telegram_id)")
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(10);
      const rows = data ?? [];
      if (!rows.length) return void (await sendMessage(chatId, "No pending payments. 🎉"));
      for (const r of rows) {
        const name = (r as { products: { name: string } | null }).products?.name ?? "item";
        const tid = (r as { bot_users: { telegram_id: number } | null }).bot_users?.telegram_id;
        const buttons: InlineButton[][] = [
          [
            { text: "✅ Approve", callback_data: `apay:${short(String(r.id))}` },
            { text: "❌ Reject", callback_data: `rpay:${short(String(r.id))}` },
          ],
        ];
        await sendMessage(
          chatId,
          [
            `💳 Order ${short(String(r.id))} · ${name}`,
            `Amount: ${formatPrice(r.total_price as number)}`,
            `Customer: ${tid ?? "unknown"}`,
            `Reference: ${r.payment_reference ?? "— not submitted —"}`,
          ].join("\n"),
          buttons,
        );
      }
      return;
    }

    case "/withdrawals": {
      const { data } = await supabaseAdmin
        .from("withdrawals")
        .select("id, amount, method, address, created_at, bot_users(telegram_id)")
        .eq("status", "pending")
        .order("created_at", { ascending: true })
        .limit(10);
      const rows = data ?? [];
      if (!rows.length) return void (await sendMessage(chatId, "No payout requests waiting. 🎉"));
      for (const w of rows) {
        const tid = (w as { bot_users: { telegram_id: number } | null }).bot_users?.telegram_id;
        await sendMessage(
          chatId,
          [
            `🏦 Payout ${short(String(w.id))}`,
            `Amount: ${formatPrice(w.amount as number)} via ${w.method}`,
            `Address: ${w.address}`,
            `Customer: ${tid ?? "unknown"}`,
          ].join("\n"),
          [
            [
              { text: "✅ Approve", callback_data: `awd:${short(String(w.id))}` },
              { text: "❌ Reject", callback_data: `rwd:${short(String(w.id))}` },
            ],
          ],
        );
      }
      return;
    }

    case "/approve_pay":
    case "/reject_pay": {
      const ref = rest.trim().split(/\s+/)[0] ?? "";
      await decidePayment(chatId, ref, command === "/approve_pay");
      return;
    }

    case "/approve_wd":
    case "/reject_wd": {
      const ref = rest.trim().split(/\s+/)[0] ?? "";
      await decidePayout(chatId, ref, command === "/approve_wd");
      return;
    }

    case "/credit":
      await adjustBalance(chatId, rest, 1);
      return;
    case "/debit":
      await adjustBalance(chatId, rest, -1);
      return;

    case "/whois": {
      const tid = Number(rest.trim());
      if (!Number.isSafeInteger(tid) || tid <= 0)
        return void (await sendMessage(chatId, "Usage: /whois <telegram id>"));
      const u = await findUserByTelegramId(tid);
      if (!u) return void (await sendMessage(chatId, "❌ No customer with that Telegram id."));
      const { count: orders } = await supabaseAdmin
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("bot_user_id", u.id);
      await sendMessage(
        chatId,
        [
          `👤 ${u.first_name ?? "Customer"} ${u.username ? `(@${u.username})` : ""}`,
          `Telegram id: ${u.telegram_id}`,
          `Role: ${u.role}${u.is_blocked ? " · BLOCKED" : ""}`,
          `Balance: ${formatPrice(u.balance)}`,
          `Referral earned: ${formatPrice(u.referral_earned ?? 0)}`,
          `Orders: ${orders ?? 0}`,
        ].join("\n"),
      );
      return;
    }

    case "/ban":
    case "/unban": {
      const tid = Number(rest.trim());
      if (!Number.isSafeInteger(tid) || tid <= 0)
        return void (await sendMessage(chatId, `Usage: ${command} <telegram id>`));
      const blocked = command === "/ban";
      const { data } = await supabaseAdmin
        .from("bot_users")
        .update({ is_blocked: blocked })
        .eq("telegram_id", tid)
        .select("id")
        .maybeSingle();
      await sendMessage(
        chatId,
        data
          ? `${blocked ? "🚫 Blocked" : "✅ Unblocked"} user ${tid}.`
          : "❌ No customer with that Telegram id.",
      );
      return;
    }

    case "/broadcast": {
      const text = rest.trim();
      if (text.length < 3)
        return void (await sendMessage(chatId, "Usage: /broadcast <message to all customers>"));
      const { data } = await supabaseAdmin
        .from("bot_users")
        .select("telegram_id")
        .eq("is_blocked", false);
      let sent = 0;
      for (const u of data ?? []) {
        await sendMessage(u.telegram_id, `📣 ${text}`);
        sent += 1;
      }
      await sendMessage(chatId, `📣 Broadcast sent to ${sent} user(s).`);
      return;
    }
  }
}

/** Confirms or rejects a manual payment, by short order id. */
export async function decidePayment(chatId: number, ref: string, approve: boolean) {
  if (!ref) return void (await sendMessage(chatId, "Usage: /approve_pay <order id>"));
  const { data: orders } = await supabaseAdmin
    .from("orders")
    .select("id, status, total_price, products(name), bot_users(telegram_id)")
    .eq("status", "pending")
    .limit(100);
  const order = (orders ?? []).find((o) => String(o.id).startsWith(ref.toLowerCase()));
  if (!order) return void (await sendMessage(chatId, "❌ No pending order with that id."));

  const tid = (order as { bot_users: { telegram_id: number } | null }).bot_users?.telegram_id;
  const name = (order as { products: { name: string } | null }).products?.name ?? "your order";

  if (!approve) {
    const { error } = await supabaseAdmin.rpc("release_order", {
      p_order: order.id,
      p_status: "cancelled",
    });
    if (error) return void (await sendMessage(chatId, `❌ ${error.message}`));
    await sendMessage(chatId, `❌ Order ${short(String(order.id))} rejected and stock released.`);
    if (tid)
      await sendMessage(
        tid,
        `❌ Your payment for ${name} could not be confirmed, so the order was cancelled. Contact support if this looks wrong.`,
      );
    return;
  }

  await supabaseAdmin
    .from("orders")
    .update({ status: "paid", paid_at: new Date().toISOString() })
    .eq("id", order.id);
  const { data: delivered, error } = await supabaseAdmin.rpc("deliver_order", {
    p_order: order.id,
  });
  if (error) return void (await sendMessage(chatId, `❌ ${error.message}`));
  const payloads = ((delivered ?? []) as { payload: string }[]).map((r) => r.payload);

  const percent = await numSetting("referral_percent", 5);
  if (percent > 0)
    await supabaseAdmin.rpc("pay_referral_commission", {
      p_order: order.id,
      p_percent: percent,
    });

  await sendMessage(
    chatId,
    `✅ Order ${short(String(order.id))} confirmed and delivered to the customer.`,
  );
  if (tid)
    await sendMessage(
      tid,
      payloads.length
        ? `📦 Payment confirmed. Your ${name} is ready:\n\n${payloads.join("\n")}\n\nThank you!`
        : `✅ Payment confirmed for ${name}. Delivery is on its way.`,
    );
}

/** Approves or rejects a payout request, by short withdrawal id. */
export async function decidePayout(chatId: number, ref: string, approve: boolean) {
  if (!ref) return void (await sendMessage(chatId, "Usage: /approve_wd <payout id>"));
  const { data: rows } = await supabaseAdmin
    .from("withdrawals")
    .select("id, amount, method, bot_users(telegram_id)")
    .eq("status", "pending")
    .limit(100);
  const w = (rows ?? []).find((r) => String(r.id).startsWith(ref.toLowerCase()));
  if (!w) return void (await sendMessage(chatId, "❌ No pending payout with that id."));

  const { error } = await supabaseAdmin.rpc("decide_withdrawal", {
    p_withdrawal: w.id,
    p_approve: approve,
    p_note: "",
  });
  if (error) return void (await sendMessage(chatId, `❌ ${error.message}`));

  const tid = (w as { bot_users: { telegram_id: number } | null }).bot_users?.telegram_id;
  await sendMessage(
    chatId,
    `${approve ? "✅ Approved" : "❌ Rejected"} payout ${short(String(w.id))} (${formatPrice(w.amount as number)}).`,
  );
  if (tid)
    await sendMessage(
      tid,
      approve
        ? `✅ Your payout of ${formatPrice(w.amount as number)} via ${w.method} was approved and is being sent.`
        : `❌ Your payout request of ${formatPrice(w.amount as number)} was rejected and the amount is back in your balance.`,
    );
}
