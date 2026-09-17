/**
 * Telegram storefront bot: command routing, customer browsing, admin catalog
 * and stock administration.
 *
 * Authorization model
 * -------------------
 * - ADMIN_TELEGRAM_IDS is a *bootstrap only* list. It is consulted exactly
 *   once per Telegram user: when their row is first created in `bot_users`.
 *   Changing the secret later does NOT promote or demote existing users.
 * - Every admin command re-reads `bot_users.role` from the database on that
 *   request. Nothing about the caller's role is cached in memory between
 *   requests, and nothing sent by the client is trusted.
 * - Later role changes are intended to happen through the admin dashboard
 *   (a future step), by updating `bot_users.role`.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  answerCallbackQuery,
  sendMessage,
  type InlineButton,
} from "./gateway.server";
import { formatPrice, isValidEmoji, isValidSlug, parsePrice } from "./validation";
import {
  balanceScreen,
  categoriesScreen,
  categoryScreen,
  effectivePrice,
  howItWorksScreen,
  mainMenu,
  methodsScreen,
  ordersScreen,
  paymentMethods,
  productScreen,
  quantityScreen,
  render,
  setting,
  summaryScreen,
  supportScreen,
  type View,
  profileScreen,
  depositScreen,
  apiScreen,
} from "./storefront.server";
import { allowRequest } from "./ratelimit.server";
import {
  OPS_COMMANDS,
  decidePayment,
  decidePayout,
  handleOpsCommand,
  referralScreen,
  requestWithdrawal,
  submitPayment,
  withdrawScreen,
} from "./ops.server";


type TgUser = { id: number; username?: string; first_name?: string };
type TgChat = { id: number; type?: string };
type TgMessage = { from?: TgUser; chat?: TgChat; text?: string };
type TgCallback = {
  id: string;
  from?: TgUser;
  data?: string;
  message?: { chat?: TgChat; message_id?: number };
};
export type TgUpdate = {
  update_id?: number;
  message?: TgMessage;
  edited_message?: TgMessage;
  callback_query?: TgCallback;
};

type BotUser = { id: string; telegram_id: number; role: "admin" | "customer"; is_blocked?: boolean };

function bootstrapAdminIds(): Set<number> {
  const raw = process.env["ADMIN_TELEGRAM_IDS"] ?? "";
  return new Set(
    raw
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isSafeInteger(n) && n > 0),
  );
}

/** Loads the bot user, creating it on first interaction (bootstrap moment). */
async function ensureUser(
  from: TgUser,
  referralCode?: string,
): Promise<BotUser | null> {
  const { data: existing } = await supabaseAdmin
    .from("bot_users")
    .select("id, telegram_id, role, is_blocked")
    .eq("telegram_id", from.id)
    .maybeSingle();

  if (existing) return existing as BotUser;

  const role = bootstrapAdminIds().has(from.id) ? "admin" : "customer";

  // Referral link: /start <code>. Only ever applied when the row is created.
  let referredBy: string | null = null;
  if (referralCode && /^[A-Za-z0-9]{4,16}$/.test(referralCode)) {
    const { data: referrer } = await supabaseAdmin
      .from("bot_users")
      .select("id, telegram_id")
      .eq("referral_code", referralCode.toUpperCase())
      .maybeSingle();
    if (referrer && referrer.telegram_id !== from.id) referredBy = referrer.id;
  }

  console.log(
    `[telegram] bootstrap: creating user ${from.id} with role '${role}'`,
  );

  const { data, error } = await supabaseAdmin
    .from("bot_users")
    .insert({
      telegram_id: from.id,
      username: from.username ?? null,
      first_name: from.first_name ?? null,
      role,
      ...(referredBy ? { referred_by: referredBy } : {}),
    })
    .select("id, telegram_id, role, is_blocked")
    .maybeSingle();

  if (error) {
    // Race: another concurrent update created the row first.
    const { data: retry } = await supabaseAdmin
      .from("bot_users")
      .select("id, telegram_id, role, is_blocked")
      .eq("telegram_id", from.id)
      .maybeSingle();
    return (retry as BotUser | null) ?? null;
  }
  return data as BotUser | null;
}

/** Re-reads the role straight from the database for this request. */
async function isAdminNow(telegramId: number): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("bot_users")
    .select("role")
    .eq("telegram_id", telegramId)
    .maybeSingle();
  return data?.role === "admin";
}

async function availableCount(productId: string): Promise<number> {
  const { count } = await supabaseAdmin
    .from("stock_items")
    .select("id", { count: "exact", head: true })
    .eq("product_id", productId)
    .eq("status", "available");
  return count ?? 0;
}

async function getProduct(slug: string) {
  const { data } = await supabaseAdmin
    .from("products")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();
  return data;
}

// ---------------------------------------------------------------- customer

/** Creates an order: reserves the units atomically, then pays from balance if possible. */
async function startCheckout(
  view: View,
  user: BotUser,
  slug: string,
  qty = 1,
  methodIndex?: number,
) {
  const chatId = view.chatId;
  const product = await getProduct(slug);
  if (!product || !product.active) {
    await sendMessage(chatId, "That product is not available.");
    return;
  }

  const { data: orderId, error } = await supabaseAdmin.rpc("place_order", {
    p_bot_user: user.id,
    p_product: product.id,
    p_qty: qty,
  });

  if (error) {
    const msg = error.message.includes("out_of_stock")
      ? "😔 Sorry, that product just sold out."
      : "😔 That product is not available right now.";
    await sendMessage(chatId, msg);
    return;
  }

  const price = effectivePrice(product) * qty;
  const { data: me } = await supabaseAdmin
    .from("bot_users")
    .select("balance")
    .eq("id", user.id)
    .maybeSingle();
  const balance = Number(me?.balance ?? 0);

  if (methodIndex === undefined && balance >= price) {
    const next = balance - price;
    await supabaseAdmin.from("bot_users").update({ balance: next }).eq("id", user.id);
    await supabaseAdmin.from("wallet_transactions").insert({
      bot_user_id: user.id,
      amount: -price,
      balance_after: next,
      reason: `Purchase: ${product.name}`,
      order_id: orderId as string,
    });
    await supabaseAdmin
      .from("orders")
      .update({ status: "paid", paid_at: new Date().toISOString(), payment_method: "balance" })
      .eq("id", orderId as string);

    const { data: delivered } = await supabaseAdmin.rpc("deliver_order", {
      p_order: orderId as string,
    });
    const payloads = ((delivered ?? []) as { payload: string }[]).map((r) => r.payload);

    // Referral commission, paid once per completed order.
    const { data: percentRow } = await supabaseAdmin
      .from("shop_settings")
      .select("value")
      .eq("key", "referral_percent")
      .maybeSingle();
    const percent = Number(percentRow?.value ?? 5);
    if (percent > 0) {
      const { data: commission } = await supabaseAdmin.rpc("pay_referral_commission", {
        p_order: orderId as string,
        p_percent: percent,
      });
      if (Number(commission ?? 0) > 0) {
        const { data: buyer } = await supabaseAdmin
          .from("bot_users")
          .select("referred_by")
          .eq("id", user.id)
          .maybeSingle();
        if (buyer?.referred_by) {
          const { data: referrer } = await supabaseAdmin
            .from("bot_users")
            .select("telegram_id, balance")
            .eq("id", buyer.referred_by)
            .maybeSingle();
          if (referrer)
            await sendMessage(
              referrer.telegram_id,
              `🎉 Referral bonus: +${formatPrice(Number(commission))} added to your balance. New balance: ${formatPrice(Number(referrer.balance))}`,
            );
        }
      }
    }
    await sendMessage(
      chatId,
      payloads.length
        ? `📦 ${product.name}\n\n${payloads.join("\n")}\n\nPaid from your balance. New balance: ${formatPrice(next)}`
        : "Your order is confirmed, but delivery needs an admin. We'll message you shortly.",
    );
    return;
  }

  const methods = await paymentMethods();
  const chosen = methodIndex === undefined ? undefined : methods[methodIndex];
  const instructions =
    chosen?.instructions ||
    (await setting(
      "payment_instructions",
      "Send payment and reply with your transaction reference. An admin will confirm it shortly.",
    ));
  const shortId = String(orderId).slice(0, 8);

  if (chosen)
    await supabaseAdmin
      .from("orders")
      .update({ payment_method: chosen.label })
      .eq("id", orderId as string);

  await render(
    { chatId, messageId: view.messageId },
    [
      `${chosen ? `💠 <b>${chosen.label}</b>` : "🧾 <b>Payment</b>"}`,
      "",
      `📦 Product: <b>${product.name}</b>`,
      `🔢 Quantity: <b>${qty}</b>`,
      `💰 Total: <b>${formatPrice(price)}</b>`,
      `🧾 Order id: <code>${shortId}</code>`,
      "",
      instructions,
      "",
      `✅ After paying, send <code>/pay ${shortId} &lt;transaction ref&gt;</code> here.`,
      "🚀 Once verified, your items are delivered automatically.",
      "",
      "<i>Your items stay reserved until an admin confirms or the order is cancelled.</i>",
    ].join("\n"),
    [
      [{ text: "🧾 My Orders", callback_data: "orders" }],
      [
        { text: "⬅️ Back", callback_data: `product:${slug}` },
        { text: "🚫 Cancel Order", callback_data: `cx:${shortId}` },
      ],
    ],
  );
}

/** Customer-initiated cancellation of their own pending order. */
async function cancelOrder(view: View, user: BotUser, shortId: string): Promise<void> {
  const { data: orders } = await supabaseAdmin
    .from("orders")
    .select("id, status")
    .eq("bot_user_id", user.id)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(20);
  const order = (orders ?? []).find((o) => String(o.id).startsWith(shortId));
  if (!order) {
    await render(view, "That order can no longer be cancelled.", [
      [{ text: "🏠 Main Menu", callback_data: "menu" }],
    ]);
    return;
  }
  await supabaseAdmin.rpc("release_order", { p_order: order.id, p_status: "cancelled" });
  await render(view, "🚫 <b>Order cancelled.</b> The items went back into stock.", [
    [{ text: "🛍 Shop", callback_data: "shop" }],
    [{ text: "🏠 Main Menu", callback_data: "menu" }],
  ]);
}

// ------------------------------------------------------------------- admin

const ADMIN_COMMANDS = new Set([
  "/admin",
  "/products",
  "/addproduct",
  "/setprice",
  "/setactive",
  "/setdesc",
  "/setemoji",
  "/delproduct",
  "/addstock",
  "/stock",
  "/clearstock",
  "/flashsale",
  "/flashsales",
  "/stopflashsale",
]);

const ADMIN_HELP = [
  "🛠 <b>Admin commands</b>",
  "",
  "<b>Catalog</b>",
  "/products — list every product",
  "/addproduct slug|Name|emoji|price",
  "/setprice slug 24.99",
  "/setactive slug on|off",
  "/setdesc slug Description…",
  "/setemoji slug &lt;id|clear&gt;",
  "/delproduct slug confirm",
  "",
  "<b>Flash sales</b>",
  "/flashsale slug sale_price hours",
  "/flashsales — list running sales",
  "/stopflashsale slug",
  "",
  "<b>Stock</b>",
  "/addstock slug (then one code per line)",
  "/stock slug",
  "/clearstock slug confirm",
  "",
  "<b>Orders &amp; money</b>",
  "/payments · /approve_pay ID · /reject_pay ID reason · /redeliver_pay ID",
  "/withdrawals · /approve_wd ID · /reject_wd ID reason",
  "/whois USER_ID · /credit USER_ID 10 · /debit USER_ID 5",
  "/ban USER_ID · /unban USER_ID · /broadcast message · /backup",
].join("\n");

async function handleAdminCommand(
  command: string,
  rest: string,
  chatId: number,
  user: BotUser,
): Promise<void> {
  // Role is re-read from the database on every admin call.
  const admin = await isAdminNow(user.telegram_id);
  if (!admin) {
    console.warn(
      `[telegram] authz denied: telegram_id=${user.telegram_id} command=${command}`,
    );
    await sendMessage(chatId, "⛔ Not authorized. This command is admin-only.");
    return;
  }
  console.log(
    `[telegram] authz ok: telegram_id=${user.telegram_id} command=${command}`,
  );

  if (OPS_COMMANDS.has(command)) {
    await handleOpsCommand(command, rest, chatId);
    return;
  }

  const firstLine = rest.split("\n")[0] ?? "";
  const args = firstLine.trim().split(/\s+/).filter(Boolean);
  const slug = args[0] ?? "";

  const noSlug = new Set(["/addproduct", "/admin", "/products", "/flashsales"]);
  if (!noSlug.has(command) && !isValidSlug(slug)) {
    await sendMessage(
      chatId,
      "❌ Invalid slug. Use 2-32 characters: lowercase letters, numbers, - or _.",
    );
    return;
  }

  switch (command) {
    case "/admin": {
      await sendMessage(chatId, ADMIN_HELP, undefined, true);
      return;
    }
    case "/products": {
      const { data: rows } = await supabaseAdmin
        .from("products")
        .select("slug, name, emoji, price, sale_price, sale_ends_at, active, category")
        .order("category")
        .order("sort_order")
        .limit(100);
      const { data: stock } = await supabaseAdmin
        .from("stock_items")
        .select("product_id, status");
      void stock;
      if (!rows || rows.length === 0) {
        await sendMessage(chatId, "No products yet. Use /addproduct.");
        return;
      }
      const lines = rows.map((p) => {
        const live =
          p.sale_price && (!p.sale_ends_at || new Date(p.sale_ends_at).getTime() > Date.now());
        const price = live ? `${formatPrice(Number(p.sale_price))} 🔥` : formatPrice(Number(p.price));
        return `${p.active ? "🟢" : "⚪️"} <code>${p.slug}</code> — ${p.emoji ?? ""} ${p.name} · ${price} · ${p.category}`;
      });
      await sendMessage(chatId, ["📦 <b>Products</b>", "", ...lines].join("\n"), undefined, true);
      return;
    }
    case "/flashsale": {
      const salePrice = parsePrice(args[1] ?? "");
      const hours = Number(args[2]);
      if (salePrice === null || !Number.isFinite(hours) || hours <= 0 || hours > 24 * 90) {
        await sendMessage(chatId, "Usage: /flashsale slug 4.99 12   (sale price, then hours)");
        return;
      }
      const { data: product } = await supabaseAdmin
        .from("products")
        .select("id, name, price")
        .eq("slug", slug)
        .maybeSingle();
      if (!product) {
        await sendMessage(chatId, "❌ No product with that slug.");
        return;
      }
      if (salePrice >= Number(product.price)) {
        await sendMessage(chatId, "❌ The sale price must be lower than the normal price.");
        return;
      }
      const endsAt = new Date(Date.now() + hours * 3600_000).toISOString();
      await supabaseAdmin
        .from("products")
        .update({ sale_price: salePrice, sale_ends_at: endsAt })
        .eq("id", product.id);
      await sendMessage(
        chatId,
        `🔥 Flash sale on ${product.name}: ${formatPrice(salePrice)} for ${hours}h (ends ${endsAt.slice(0, 16).replace("T", " ")} UTC).`,
      );
      return;
    }
    case "/flashsales": {
      const { data: rows } = await supabaseAdmin
        .from("products")
        .select("slug, name, price, sale_price, sale_ends_at")
        .not("sale_price", "is", null)
        .limit(100);
      const live = (rows ?? []).filter(
        (p) =>
          Number(p.sale_price) > 0 &&
          Number(p.sale_price) < Number(p.price) &&
          (!p.sale_ends_at || new Date(p.sale_ends_at).getTime() > Date.now()),
      );
      if (live.length === 0) {
        await sendMessage(chatId, "No flash sales are running.");
        return;
      }
      await sendMessage(
        chatId,
        [
          "🔥 <b>Flash sales</b>",
          "",
          ...live.map(
            (p) =>
              `<code>${p.slug}</code> — ${p.name}: ${formatPrice(Number(p.sale_price))} (was ${formatPrice(Number(p.price))})${p.sale_ends_at ? ` · ends ${String(p.sale_ends_at).slice(0, 16).replace("T", " ")} UTC` : " · no end time"}`,
          ),
        ].join("\n"),
        undefined,
        true,
      );
      return;
    }
    case "/stopflashsale": {
      const { error } = await supabaseAdmin
        .from("products")
        .update({ sale_price: null, sale_ends_at: null })
        .eq("slug", slug);
      await sendMessage(chatId, error ? `❌ ${error.message}` : `✅ Flash sale stopped for ${slug}.`);
      return;
    }
    case "/addproduct": {
      const parts = rest.trim().split("|").map((p) => p.trim());
      if (parts.length !== 4) {
        await sendMessage(
          chatId,
          "Usage: /addproduct slug|Name|emoji|price\nExample: /addproduct gift-card|Gift Card|🎁|9.99",
        );
        return;
      }
      const [newSlug, name, emoji, priceRaw] = parts as [string, string, string, string];
      if (!isValidSlug(newSlug)) {
        await sendMessage(
          chatId,
          "❌ Invalid slug. Use 2-32 characters: lowercase letters, numbers, - or _.",
        );
        return;
      }
      if (!name || name.length > 80) {
        await sendMessage(chatId, "❌ Name must be 1-80 characters.");
        return;
      }
      if (emoji && !isValidEmoji(emoji)) {
        await sendMessage(chatId, "❌ Invalid emoji (use an emoji or a custom emoji id).");
        return;
      }
      const price = parsePrice(priceRaw);
      if (price === null) {
        await sendMessage(
          chatId,
          "❌ Price must be a positive number with up to 2 decimals (e.g. 9.99).",
        );
        return;
      }
      const { error } = await supabaseAdmin.from("products").insert({
        slug: newSlug,
        name,
        emoji: emoji || null,
        price,
        active: false,
      });
      if (error) {
        await sendMessage(
          chatId,
          error.code === "23505"
            ? `❌ A product with slug "${newSlug}" already exists.`
            : "❌ Could not create the product.",
        );
        return;
      }
      await sendMessage(
        chatId,
        `✅ Created "${name}" (${newSlug}) at ${formatPrice(price)}. It is inactive until you add stock and run /setactive ${newSlug} on.`,
      );
      return;
    }

    case "/setprice": {
      const price = parsePrice(args[1] ?? "");
      if (price === null) {
        await sendMessage(chatId, "Usage: /setprice slug 9.99 (positive number)");
        return;
      }
      const product = await getProduct(slug);
      if (!product) return void (await sendMessage(chatId, "❌ Product not found."));
      await supabaseAdmin.from("products").update({ price }).eq("id", product.id);
      await sendMessage(chatId, `✅ ${slug} price set to ${formatPrice(price)}.`);
      return;
    }

    case "/setactive": {
      const flag = (args[1] ?? "").toLowerCase();
      if (flag !== "on" && flag !== "off") {
        await sendMessage(chatId, "Usage: /setactive slug on|off");
        return;
      }
      const product = await getProduct(slug);
      if (!product) return void (await sendMessage(chatId, "❌ Product not found."));
      if (flag === "on" && (await availableCount(product.id)) === 0) {
        await sendMessage(
          chatId,
          `❌ ${slug} has no available stock. Add stock first with /addstock.`,
        );
        return;
      }
      await supabaseAdmin
        .from("products")
        .update({ active: flag === "on" })
        .eq("id", product.id);
      await sendMessage(chatId, `✅ ${slug} is now ${flag === "on" ? "active" : "inactive"}.`);
      return;
    }

    case "/setdesc": {
      const desc = rest.trim().slice(slug.length).trim();
      if (!desc || desc.length > 1000) {
        await sendMessage(chatId, "Usage: /setdesc slug <description, 1-1000 chars>");
        return;
      }
      const product = await getProduct(slug);
      if (!product) return void (await sendMessage(chatId, "❌ Product not found."));
      await supabaseAdmin
        .from("products")
        .update({ description: desc })
        .eq("id", product.id);
      await sendMessage(chatId, `✅ Description updated for ${slug}.`);
      return;
    }

    case "/setemoji": {
      const value = args[1] ?? "";
      if (value !== "clear" && !isValidEmoji(value)) {
        await sendMessage(chatId, 'Usage: /setemoji slug <emoji or id or "clear">');
        return;
      }
      const product = await getProduct(slug);
      if (!product) return void (await sendMessage(chatId, "❌ Product not found."));
      await supabaseAdmin
        .from("products")
        .update({ emoji: value === "clear" ? null : value })
        .eq("id", product.id);
      await sendMessage(
        chatId,
        value === "clear" ? `✅ Emoji cleared for ${slug}.` : `✅ Emoji set for ${slug}.`,
      );
      return;
    }

    case "/delproduct": {
      if ((args[1] ?? "") !== "confirm") {
        await sendMessage(
          chatId,
          `❌ Refused. To delete, run: /delproduct ${slug} confirm`,
        );
        return;
      }
      const product = await getProduct(slug);
      if (!product) return void (await sendMessage(chatId, "❌ Product not found."));

      const { count: deliveredOrReserved } = await supabaseAdmin
        .from("stock_items")
        .select("id", { count: "exact", head: true })
        .eq("product_id", product.id)
        .in("status", ["delivered", "reserved"]);

      if ((deliveredOrReserved ?? 0) > 0) {
        await supabaseAdmin
          .from("products")
          .update({ active: false })
          .eq("id", product.id);
        await sendMessage(
          chatId,
          `⚠️ ${slug} has ${deliveredOrReserved} delivered/reserved stock items, so it cannot be deleted. It has been disabled instead (active = off).`,
        );
        return;
      }

      await supabaseAdmin.from("stock_items").delete().eq("product_id", product.id);
      await supabaseAdmin.from("products").delete().eq("id", product.id);
      await sendMessage(chatId, `🗑 Deleted ${slug} and its unsold stock.`);
      return;
    }

    case "/addstock": {
      const product = await getProduct(slug);
      if (!product) return void (await sendMessage(chatId, "❌ Product not found."));
      const lines = rest
        .split("\n")
        .slice(1)
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && l.length <= 2000);
      if (lines.length === 0) {
        await sendMessage(
          chatId,
          "Usage: /addstock slug\n<one payload per line on the following lines>",
        );
        return;
      }
      const { error } = await supabaseAdmin
        .from("stock_items")
        .insert(lines.map((payload) => ({ product_id: product.id, payload })));
      if (error) {
        await sendMessage(chatId, "❌ Could not add stock.");
        return;
      }
      await sendMessage(
        chatId,
        `✅ Added ${lines.length} stock item(s) to ${slug}. Available now: ${await availableCount(product.id)}.`,
      );
      return;
    }

    case "/stock": {
      const product = await getProduct(slug);
      if (!product) return void (await sendMessage(chatId, "❌ Product not found."));
      const counts: Record<string, number> = { available: 0, reserved: 0, delivered: 0 };
      for (const status of Object.keys(counts)) {
        const { count } = await supabaseAdmin
          .from("stock_items")
          .select("id", { count: "exact", head: true })
          .eq("product_id", product.id)
          .eq("status", status as "available" | "reserved" | "delivered");
        counts[status] = count ?? 0;
      }
      await sendMessage(
        chatId,
        `📦 ${slug}\nAvailable: ${counts["available"]}\nReserved: ${counts["reserved"]}\nDelivered: ${counts["delivered"]}`,
      );
      return;
    }

    case "/clearstock": {
      if ((args[1] ?? "") !== "confirm") {
        await sendMessage(
          chatId,
          `❌ Refused. To clear available stock, run: /clearstock ${slug} confirm`,
        );
        return;
      }
      const product = await getProduct(slug);
      if (!product) return void (await sendMessage(chatId, "❌ Product not found."));
      const { data: removed } = await supabaseAdmin
        .from("stock_items")
        .delete()
        .eq("product_id", product.id)
        .eq("status", "available")
        .select("id");
      await sendMessage(
        chatId,
        `🧹 Removed ${removed?.length ?? 0} available stock item(s) from ${slug}. Reserved and delivered items were untouched.`,
      );
      return;
    }
  }
}

// ------------------------------------------------------------------ router

export async function handleUpdate(update: TgUpdate): Promise<void> {
  const callback = update.callback_query;
  if (callback?.from && callback.message?.chat?.id) {
    if (!(await allowRequest(callback.from.id))) {
      await answerCallbackQuery(callback.id);
      return;
    }
    const user = await ensureUser(callback.from);
    if (!user) return;
    const chatId = callback.message.chat.id;
    const data = callback.data ?? "";
    await answerCallbackQuery(callback.id);

    if (user.is_blocked) {
      await sendMessage(chatId, "⛔ Your access to this shop has been disabled.");
      return;
    }

    const view: View = { chatId, messageId: callback.message.message_id };

    if (data === "menu" || data.startsWith("start")) {
      await mainMenu(view, user);
    } else if (data === "shop" || data.startsWith("browse")) {
      await categoriesScreen(view);
    } else if (data.startsWith("cat:")) {
      const [, idx, page] = data.split(":");
      await categoryScreen(view, Number(idx) || 0, Math.max(0, Number(page) || 0));
    } else if (data.startsWith("product:")) {
      await productScreen(view, data.slice(8));
    } else if (data.startsWith("buy:")) {
      await quantityScreen(view, data.slice(4));
    } else if (data.startsWith("qty:")) {
      const [, slug, qty] = data.split(":");
      await summaryScreen(view, user, slug ?? "", Math.max(1, Number(qty) || 1));
    } else if (data.startsWith("paybal:")) {
      const [, slug, qty] = data.split(":");
      await startCheckout(view, user, slug ?? "", Math.max(1, Number(qty) || 1));
    } else if (data.startsWith("pm:")) {
      const [, slug, qty] = data.split(":");
      await methodsScreen(view, slug ?? "", Math.max(1, Number(qty) || 1));
    } else if (data.startsWith("pmx:")) {
      const [, slug, qty, idx] = data.split(":");
      await startCheckout(
        view,
        user,
        slug ?? "",
        Math.max(1, Number(qty) || 1),
        Math.max(0, Number(idx) || 0),
      );
    } else if (data.startsWith("cx:")) {
      await cancelOrder(view, user, data.slice(3));
    } else if (data.startsWith("orders")) {
      await ordersScreen(view, user);
    } else if (data.startsWith("balance")) {
      await balanceScreen(view, user);
    } else if (data === "profile") {
      await profileScreen(view, user);
    } else if (data === "deposit") {
      await depositScreen(view, user);
    } else if (data === "api") {
      await apiScreen(view);
    } else if (data === "support") {
      await supportScreen(view);
    } else if (data === "how") {
      await howItWorksScreen(view);
    } else if (data === "refer") {
      await referralScreen(view, user, process.env["TELEGRAM_BOT_USERNAME"] ?? "");
    } else if (data === "withdraw") {
      await withdrawScreen(view, user);
    } else if (/^(apay|rpay|awd|rwd):/.test(data)) {
      // Admin actions from the in-Telegram panel: role re-read from the DB.
      if (!(await isAdminNow(user.telegram_id))) {
        console.warn(`[telegram] authz denied: telegram_id=${user.telegram_id} action=${data}`);
        await sendMessage(chatId, "⛔ Not authorized.");
        return;
      }
      const [kind, ref] = data.split(":") as [string, string];
      if (kind === "apay") await decidePayment(chatId, ref, true);
      else if (kind === "rpay") await decidePayment(chatId, ref, false);
      else if (kind === "awd") await decidePayout(chatId, ref, true);
      else await decidePayout(chatId, ref, false);
    }
    return;
  }

  const message = update.message ?? update.edited_message;
  if (!message?.from || !message.chat?.id) return;
  if (!(await allowRequest(message.from.id))) {
    await sendMessage(
      message.chat.id,
      "⏳ Too many requests. Please wait about half a minute and try again.",
    );
    return;
  }

  const startPayload = (message.text ?? "").trim().startsWith("/start")
    ? (message.text ?? "").trim().split(/\s+/)[1]
    : undefined;
  const user = await ensureUser(message.from, startPayload);
  if (!user) return;

  const chatId = message.chat.id;
  if (user.is_blocked) {
    await sendMessage(chatId, "⛔ Your access to this shop has been disabled.");
    return;
  }
  const isPrivate = (message.chat.type ?? "private") === "private";
  const text = (message.text ?? "").trim();
  if (!text.startsWith("/")) return;

  const [rawCommand, ...restParts] = text.split(/\s+/);
  const command = (rawCommand ?? "").split("@")[0]!.toLowerCase();
  const rest = text.slice((rawCommand ?? "").length).trim();
  void restParts;

  if (ADMIN_COMMANDS.has(command) || OPS_COMMANDS.has(command)) {
    if (!isPrivate) {
      console.warn(
        `[telegram] admin command ${command} rejected: non-private chat ${chatId}`,
      );
      await sendMessage(chatId, "⛔ Admin commands only work in a private chat with the bot.");
      return;
    }
    await handleAdminCommand(command, rest, chatId, user);
    return;
  }

  switch (command) {
    case "/start":
    case "/menu":
      await mainMenu({ chatId }, user);
      return;
    case "/shop":
    case "/browse":
      await categoriesScreen({ chatId });
      return;
    case "/orders":
      await ordersScreen({ chatId }, user);
      return;
    case "/balance":
      await balanceScreen({ chatId }, user);
      return;
    case "/support":
      await supportScreen({ chatId });
      return;
    case "/refer":
      await referralScreen({ chatId }, user, process.env["TELEGRAM_BOT_USERNAME"] ?? "");
      return;
    case "/withdraw":
      if (rest.trim()) await requestWithdrawal(chatId, user, rest);
      else await withdrawScreen({ chatId }, user);
      return;
    case "/pay":
      await submitPayment(chatId, user, rest);
      return;
    case "/help":
      await sendMessage(
        chatId,
        [
          "Commands:",
          "/start — main menu",
          "/shop — browse categories",
          "/orders — your orders",
          "/balance — your balance",
          "/pay <order id> <transaction ref> — submit a payment",
          "/refer — your referral link and earnings",
          "/withdraw — request a payout",
          "/support — get help",
        ].join("\n"),
      );
      return;
    default:
      await sendMessage(chatId, "Unknown command. Try /start.");
  }
}
