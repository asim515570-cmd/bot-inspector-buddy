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

const PAGE_SIZE = 8;

type TgUser = { id: number; username?: string; first_name?: string };
type TgChat = { id: number; type?: string };
type TgMessage = { from?: TgUser; chat?: TgChat; text?: string };
type TgCallback = {
  id: string;
  from?: TgUser;
  data?: string;
  message?: { chat?: TgChat };
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
async function ensureUser(from: TgUser): Promise<BotUser | null> {
  const { data: existing } = await supabaseAdmin
    .from("bot_users")
    .select("id, telegram_id, role, is_blocked")
    .eq("telegram_id", from.id)
    .maybeSingle();

  if (existing) return existing as BotUser;

  const role = bootstrapAdminIds().has(from.id) ? "admin" : "customer";
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

async function setting(key: string, fallback: string): Promise<string> {
  const { data } = await supabaseAdmin
    .from("shop_settings")
    .select("value")
    .eq("key", key)
    .maybeSingle();
  const value = (data?.value ?? "").trim();
  return value || fallback;
}

async function showWelcome(chatId: number) {
  const welcome = await setting("welcome_message", "Welcome to the shop! 🛍");
  await sendMessage(chatId, `${welcome}\n\nTap below to see what's in stock.`, [
    [{ text: "Browse Products", callback_data: "browse:0" }],
    [
      { text: "My Orders", callback_data: "orders:0" },
      { text: "Balance", callback_data: "balance:0" },
    ],
  ]);
}

/** Creates an order: reserves one unit atomically, then pays from balance if possible. */
async function startCheckout(chatId: number, user: BotUser, slug: string) {
  const product = await getProduct(slug);
  if (!product || !product.active) {
    await sendMessage(chatId, "That product is not available.");
    return;
  }

  const { data: orderId, error } = await supabaseAdmin.rpc("place_order", {
    p_bot_user: user.id,
    p_product: product.id,
  });

  if (error) {
    const msg = error.message.includes("out_of_stock")
      ? "😔 Sorry, that product just sold out."
      : "😔 That product is not available right now.";
    await sendMessage(chatId, msg);
    return;
  }

  const price = Number(product.price);
  const { data: me } = await supabaseAdmin
    .from("bot_users")
    .select("balance")
    .eq("id", user.id)
    .maybeSingle();
  const balance = Number(me?.balance ?? 0);

  if (balance >= price) {
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
    await sendMessage(
      chatId,
      payloads.length
        ? `📦 ${product.name}\n\n${payloads.join("\n")}\n\nPaid from your balance. New balance: ${formatPrice(next)}`
        : "Your order is confirmed, but delivery needs an admin. We'll message you shortly.",
    );
    return;
  }

  const instructions = await setting(
    "payment_instructions",
    "Send payment and reply with your transaction reference. An admin will confirm it shortly.",
  );
  await sendMessage(
    chatId,
    [
      `🧾 Order created for ${product.name}`,
      `Amount: ${formatPrice(price)}`,
      `Order id: ${String(orderId).slice(0, 8)}`,
      "",
      instructions,
      "",
      "Your item is reserved until an admin confirms or cancels the order.",
    ].join("\n"),
    [[{ text: "My Orders", callback_data: "orders:0" }]],
  );
}

async function showOrders(chatId: number, user: BotUser) {
  const { data } = await supabaseAdmin
    .from("orders")
    .select("id, status, total_price, created_at, products(name, emoji)")
    .eq("bot_user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(10);

  const rows = data ?? [];
  if (rows.length === 0) {
    await sendMessage(chatId, "You have no orders yet.");
    return;
  }
  const lines = rows.map((o) => {
    const p = (o as { products: { name: string; emoji: string | null } | null }).products;
    return `${String(o.id).slice(0, 8)} · ${p?.name ?? "item"} · ${formatPrice(o.total_price)} · ${o.status}`;
  });
  await sendMessage(chatId, `🧾 Your latest orders:\n\n${lines.join("\n")}`);
}

async function showBalance(chatId: number, user: BotUser) {
  const { data } = await supabaseAdmin
    .from("bot_users")
    .select("balance")
    .eq("id", user.id)
    .maybeSingle();
  await sendMessage(
    chatId,
    `💰 Your balance: ${formatPrice(Number(data?.balance ?? 0))}\n\nBalance is added by an admin (top-ups and refunds) and is spent automatically at checkout.`,
  );
}

async function showCatalog(chatId: number, page: number) {
  const from = page * PAGE_SIZE;
  const { data, count } = await supabaseAdmin
    .from("products")
    .select("slug, name, emoji, price", { count: "exact" })
    .eq("active", true)
    .order("name", { ascending: true })
    .range(from, from + PAGE_SIZE - 1);

  const products = data ?? [];
  if (products.length === 0) {
    await sendMessage(chatId, "No products are available right now.");
    return;
  }

  const rows: InlineButton[][] = products.map((p) => [
    {
      text: `${p.emoji ? `${p.emoji} ` : ""}${p.name} — ${formatPrice(p.price)}`,
      callback_data: `product:${p.slug}`,
    },
  ]);

  const nav: InlineButton[] = [];
  if (page > 0) nav.push({ text: "« Prev", callback_data: `browse:${page - 1}` });
  if ((count ?? 0) > from + PAGE_SIZE)
    nav.push({ text: "Next »", callback_data: `browse:${page + 1}` });
  if (nav.length) rows.push(nav);

  await sendMessage(chatId, "Products:", rows);
}

async function showProduct(chatId: number, slug: string) {
  const product = await getProduct(slug);
  if (!product || !product.active) {
    await sendMessage(chatId, "That product is not available.");
    return;
  }
  const stock = await availableCount(product.id);
  const lines = [
    `${product.emoji ? `${product.emoji} ` : ""}${product.name}`,
    product.description ? `\n${product.description}` : "",
    `\nPrice: ${formatPrice(product.price)}`,
    `In stock: ${stock}`,
  ].filter(Boolean);

  await sendMessage(chatId, lines.join("\n"), [
    [{ text: "Buy", callback_data: `buy:${product.slug}` }],
    [{ text: "« Back", callback_data: "browse:0" }],
  ]);
}

// ------------------------------------------------------------------- admin

const ADMIN_COMMANDS = new Set([
  "/addproduct",
  "/setprice",
  "/setactive",
  "/setdesc",
  "/setemoji",
  "/delproduct",
  "/addstock",
  "/stock",
  "/clearstock",
]);

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

  const firstLine = rest.split("\n")[0] ?? "";
  const args = firstLine.trim().split(/\s+/).filter(Boolean);
  const slug = args[0] ?? "";

  const needsSlug = command !== "/addproduct";
  if (needsSlug && !isValidSlug(slug)) {
    await sendMessage(
      chatId,
      "❌ Invalid slug. Use 2-32 characters: lowercase letters, numbers, - or _.",
    );
    return;
  }

  switch (command) {
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
    const user = await ensureUser(callback.from);
    if (!user) return;
    const chatId = callback.message.chat.id;
    const data = callback.data ?? "";
    await answerCallbackQuery(callback.id);

    if (user.is_blocked) {
      await sendMessage(chatId, "⛔ Your access to this shop has been disabled.");
      return;
    }

    if (data.startsWith("browse:")) {
      const page = Math.max(0, Number(data.slice(7)) || 0);
      await showCatalog(chatId, page);
    } else if (data.startsWith("product:")) {
      await showProduct(chatId, data.slice(8));
    } else if (data.startsWith("buy:")) {
      await startCheckout(chatId, user, data.slice(4));
    } else if (data.startsWith("orders:")) {
      await showOrders(chatId, user);
    } else if (data.startsWith("balance:")) {
      await showBalance(chatId, user);
    }
    return;
  }

  const message = update.message ?? update.edited_message;
  if (!message?.from || !message.chat?.id) return;

  const user = await ensureUser(message.from);
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

  if (ADMIN_COMMANDS.has(command)) {
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
      await showWelcome(chatId);
      return;
    case "/browse":
      await showCatalog(chatId, 0);
      return;
    case "/orders":
      await showOrders(chatId, user);
      return;
    case "/balance":
      await showBalance(chatId, user);
      return;
    case "/support": {
      const contact = await setting("support_contact", "");
      await sendMessage(
        chatId,
        contact ? `Need help? Contact ${contact}` : "Support contact has not been set up yet.",
      );
      return;
    }
    case "/help":
      await sendMessage(
        chatId,
        "Commands:\n/start — main menu\n/browse — see products\n/orders — your orders\n/balance — your balance\n/support — get help",
      );
      return;
    default:
      await sendMessage(chatId, "Unknown command. Try /start.");
  }
}
