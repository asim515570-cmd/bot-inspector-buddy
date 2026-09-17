/**
 * Customer-facing storefront screens for the Telegram bot.
 *
 * The whole customer UI is a single message that gets edited in place
 * (menu -> categories -> product list -> product detail), so the chat stays
 * clean instead of filling up with screens.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  editMessageText,
  sendMessage,
  type InlineButton,
} from "./gateway.server";
import { formatPrice } from "./validation";

export const PAGE_SIZE = 6;

export type View = { chatId: number; messageId?: number | undefined };
export type ShopUser = { id: string; telegram_id: number };

type ProductRow = {
  id: string;
  slug: string;
  name: string;
  emoji: string | null;
  category: string;
  price: number | string;
  sale_price: number | string | null;
  sale_ends_at?: string | null;
  description: string | null;
  delivery_note: string | null;
};

export function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Sends the screen, editing the current message when there is one. */
export async function render(
  view: View,
  text: string,
  keyboard: InlineButton[][],
): Promise<void> {
  if (view.messageId) {
    const ok = await editMessageText(view.chatId, view.messageId, text, keyboard, true);
    if (ok) return;
  }
  await sendMessage(view.chatId, text, keyboard, true);
}

export async function setting(key: string, fallback: string): Promise<string> {
  const { data } = await supabaseAdmin
    .from("shop_settings")
    .select("value")
    .eq("key", key)
    .maybeSingle();
  return ((data?.value ?? "") as string).trim() || fallback;
}

export function effectivePrice(p: {
  price: number | string;
  sale_price: number | string | null;
  sale_ends_at?: string | null;
}): number {
  const base = Number(p.price);
  const sale = p.sale_price === null ? null : Number(p.sale_price);
  const live = !p.sale_ends_at || new Date(p.sale_ends_at).getTime() > Date.now();
  return live && sale !== null && sale > 0 && sale < base ? sale : base;
}

function priceLabel(p: ProductRow): string {
  const base = Number(p.price);
  const now = effectivePrice(p);
  return now < base ? `${formatPrice(now)} (was ${formatPrice(base)})` : formatPrice(now);
}

/** Available stock counts for a set of products, in one query. */
async function stockCounts(productIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (productIds.length === 0) return counts;
  const { data } = await supabaseAdmin
    .from("stock_items")
    .select("product_id")
    .eq("status", "available")
    .in("product_id", productIds);
  for (const row of data ?? []) {
    const id = (row as { product_id: string }).product_id;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

/** How many units of a product have been delivered so far. */
async function soldCount(productId: string): Promise<number> {
  const { count } = await supabaseAdmin
    .from("stock_items")
    .select("id", { count: "exact", head: true })
    .eq("product_id", productId)
    .eq("status", "delivered");
  return count ?? 0;
}

export async function listCategories(): Promise<string[]> {
  const { data } = await supabaseAdmin
    .from("products")
    .select("category")
    .eq("active", true);
  const set = new Set<string>();
  for (const row of data ?? []) set.add((row as { category: string }).category);
  return [...set].sort((a, b) => a.localeCompare(b));
}

const navRow = (extra: InlineButton[] = []): InlineButton[][] => [
  [...extra],
  [
    { text: "🏠 Menu", callback_data: "menu" },
    { text: "🛍 Shop", callback_data: "shop" },
  ],
];

// ------------------------------------------------------------------ screens

export async function mainMenu(view: View, user: ShopUser): Promise<void> {
  const [storeName, welcome, channel, group, terms, notice, { data: me }] =
    await Promise.all([
      setting("store_name", "our store"),
      setting(
        "welcome_message",
        "We offer premium digital products at the best prices. Fast, secure, and fully automated delivery.",
      ),
      setting("channel_url", ""),
      setting("group_url", ""),
      setting("terms_url", ""),
      setting("notice", ""),
      supabaseAdmin
        .from("bot_users")
        .select("balance, first_name")
        .eq("id", user.id)
        .maybeSingle(),
    ]);

  const name = (me?.first_name ?? "").trim() || "there";
  const lines = [
    `🏪 <b>Welcome to ${esc(storeName)}!</b>`,
    "",
    `Hey ${esc(name)}! 👋`,
    "",
    esc(welcome),
    "",
    "<blockquote>🛍 <b>Shop</b> — Browse &amp; buy products",
    "💳 <b>Deposit</b> — Add funds to your wallet",
    "👤 <b>My Profile</b> — Balance, orders &amp; settings",
    "🛰 <b>Developer API</b> — Reseller &amp; automated ordering",
    "⭐ <b>Refer &amp; Earn</b> — Invite friends &amp; earn rewards</blockquote>",
  ];
  if (channel) lines.push("", `📣 Channel: <a href="${esc(channel)}">Join Channel</a>`);
  if (group) lines.push(`💬 Group: <a href="${esc(group)}">Join Group Chat</a>`);
  if (terms) lines.push("", `Terms of Service: <a href="${esc(terms)}">Read here</a>`);
  if (notice) lines.push("", `<blockquote>⚠️ <b>Notification</b>\n${esc(notice)}</blockquote>`);
  lines.push(
    "",
    `💰 Wallet balance: <b>${formatPrice(Number(me?.balance ?? 0))}</b>`,
    "",
    "Choose an option below to continue!",
  );

  await render(view, lines.join("\n"), [
    [{ text: "🛍 Shop", callback_data: "shop" }],
    [
      { text: "👤 My Profile", callback_data: "profile" },
      { text: "💳 Deposit", callback_data: "deposit" },
    ],
    [{ text: "🛰 Developer API", callback_data: "api" }],
    [{ text: "🆘 Support", callback_data: "support" }],
    [{ text: "⭐ Refer & Earn", callback_data: "refer" }],
  ]);
}

/** Account overview: balance, orders, referral earnings. */
export async function profileScreen(view: View, user: ShopUser): Promise<void> {
  const [{ data: me }, { data: orders }] = await Promise.all([
    supabaseAdmin
      .from("bot_users")
      .select("balance, referral_earned, referral_code, created_at, telegram_id, username")
      .eq("id", user.id)
      .maybeSingle(),
    supabaseAdmin.from("orders").select("status, total_price").eq("bot_user_id", user.id),
  ]);
  const rows = orders ?? [];
  const spent = rows
    .filter((o) => o.status === "delivered" || o.status === "paid")
    .reduce((s, o) => s + Number(o.total_price ?? 0), 0);

  const text = [
    "👤 <b>My Profile</b>",
    "",
    `🆔 Telegram ID: <code>${me?.telegram_id ?? user.telegram_id}</code>`,
    `💰 Balance: <b>${formatPrice(Number(me?.balance ?? 0))}</b>`,
    `🧾 Orders: <b>${rows.length}</b>`,
    `💸 Total spent: <b>${formatPrice(spent)}</b>`,
    `⭐ Referral earnings: <b>${formatPrice(Number(me?.referral_earned ?? 0))}</b>`,
    `🔗 Referral code: <code>${esc(me?.referral_code ?? "-")}</code>`,
  ].join("\n");

  await render(view, text, [
    [
      { text: "🧾 My Orders", callback_data: "orders" },
      { text: "💰 Balance", callback_data: "balance" },
    ],
    [
      { text: "🏦 Withdraw", callback_data: "withdraw" },
      { text: "⭐ Refer & Earn", callback_data: "refer" },
    ],
    [{ text: "🏠 Main Menu", callback_data: "menu" }],
  ]);
}

/** How to top up the wallet — instructions come from the dashboard settings. */
export async function depositScreen(view: View, user: ShopUser): Promise<void> {
  const [methods, instructions, { data: me }] = await Promise.all([
    paymentMethods(),
    setting("payment_instructions", "Contact support to top up your wallet."),
    supabaseAdmin.from("bot_users").select("balance").eq("id", user.id).maybeSingle(),
  ]);

  const lines = [
    "💳 <b>Deposit funds</b>",
    "",
    `Current balance: <b>${formatPrice(Number(me?.balance ?? 0))}</b>`,
    "",
    esc(instructions),
  ];
  if (methods.length > 0) {
    lines.push("", "<b>Accepted methods</b>");
    for (const m of methods) lines.push(`• <b>${esc(m.label)}</b> — ${esc(m.instructions)}`);
  }
  lines.push(
    "",
    "<i>After paying, send the transaction ID with /pay &lt;reference&gt; — an admin verifies it and your balance is credited.</i>",
  );

  await render(view, lines.join("\n"), [
    [{ text: "🆘 Support", callback_data: "support" }],
    [{ text: "🏠 Main Menu", callback_data: "menu" }],
  ]);
}

/** Reseller / API information screen. */
export async function apiScreen(view: View): Promise<void> {
  const info = await setting(
    "api_info",
    "Automated ordering for resellers is available on request. Contact support with your expected monthly volume and we will set up an API key for your account.",
  );
  await render(
    view,
    ["🛰 <b>Developer API</b>", "", esc(info)].join("\n"),
    [
      [{ text: "🆘 Support", callback_data: "support" }],
      [{ text: "🏠 Main Menu", callback_data: "menu" }],
    ],
  );
}

export async function categoriesScreen(view: View, page = 0): Promise<void> {
  const from = page * PAGE_SIZE;
  const { data, count } = await supabaseAdmin
    .from("products")
    .select("id, slug, name, emoji, category, price, sale_price, sale_ends_at, description, delivery_note", {
      count: "exact",
    })
    .eq("active", true)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true })
    .range(from, from + PAGE_SIZE - 1);
  const products = (data ?? []) as ProductRow[];

  if (products.length === 0) {
    await render(view, "😴 <b>No products are available right now.</b>\n\nCheck back soon.", [
      [{ text: "🏠 Menu", callback_data: "menu" }],
    ]);
    return;
  }

  const counts = await stockCounts(products.map((product) => product.id));
  const total = count ?? products.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(Math.max(0, page), pages - 1);
  const lines: string[] = [
    "🛍 <b>Choose Your Product</b>",
    `<i>Page ${safePage + 1}/${pages} · ${total} products</i>`,
  ];
  const buttons: InlineButton[][] = [];
  products.forEach((product) => {
    const stock = counts.get(product.id) ?? 0;
    buttons.push([
      {
        text: `${product.emoji ? `${product.emoji} ` : ""}${product.name} | ${formatPrice(effectivePrice(product))} (${stock})`,
        callback_data: `product:${product.slug}`,
      },
    ]);
  });

  const self = `browse:${safePage}`;
  buttons.push([
    safePage > 0
      ? { text: "Prev", callback_data: `browse:${safePage - 1}` }
      : { text: "·", callback_data: self },
    { text: `${safePage + 1}/${pages}`, callback_data: self },
    safePage + 1 < pages
      ? { text: "Next", callback_data: `browse:${safePage + 1}` }
      : { text: "End", callback_data: self },
  ]);
  buttons.push([{ text: "🔄 Refresh", callback_data: self }]);
  buttons.push([{ text: "🏠 Menu", callback_data: "menu" }]);
  await render(view, lines.join("\n"), buttons);
}

export async function categoryScreen(
  view: View,
  categoryIndex: number,
  page: number,
): Promise<void> {
  const categories = await listCategories();
  const category = categories[categoryIndex];
  if (!category) {
    await categoriesScreen(view);
    return;
  }

  const from = page * PAGE_SIZE;
  const { data, count } = await supabaseAdmin
    .from("products")
    .select("id, slug, name, emoji, category, price, sale_price, sale_ends_at, description, delivery_note", {
      count: "exact",
    })
    .eq("active", true)
    .eq("category", category)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true })
    .range(from, from + PAGE_SIZE - 1);

  const products = (data ?? []) as ProductRow[];
  if (products.length === 0) {
    await categoriesScreen(view);
    return;
  }
  const counts = await stockCounts(products.map((p) => p.id));
  const total = count ?? products.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const header = `🛒 <b>Choose Your Product:</b>\n<i>${esc(category)} · page ${page + 1}/${pages}</i>`;
  const buttons: InlineButton[][] = [];
  for (const p of products) {
    const stock = counts.get(p.id) ?? 0;
    buttons.push([
      {
        text: `${p.emoji ? `${p.emoji} ` : ""}${p.name} | ${formatPrice(effectivePrice(p))} (${stock})`,
        callback_data: `product:${p.slug}`,
      },
    ]);
  }

  const self = `cat:${categoryIndex}:${page}`;
  buttons.push([
    page > 0
      ? { text: "Prev", callback_data: `cat:${categoryIndex}:${page - 1}` }
      : { text: "·", callback_data: self },
    { text: `${page + 1}/${pages}`, callback_data: self },
    page + 1 < pages
      ? { text: "Next", callback_data: `cat:${categoryIndex}:${page + 1}` }
      : { text: "End", callback_data: self },
  ]);
  buttons.push([{ text: "🔄 Refresh", callback_data: self }]);
  buttons.push([
    { text: "⬅️ Back", callback_data: "shop" },
    { text: "🏠 Menu", callback_data: "menu" },
  ]);

  await render(view, header, buttons);
}

export async function productScreen(view: View, slug: string): Promise<void> {
  const { data } = await supabaseAdmin
    .from("products")
    .select("id, slug, name, emoji, category, price, sale_price, sale_ends_at, description, delivery_note, active")
    .eq("slug", slug)
    .maybeSingle();

  const product = data as (ProductRow & { active: boolean }) | null;
  if (!product || !product.active) {
    await render(view, "❌ <b>That product is not available.</b>", [
      [{ text: "🛍 Shop", callback_data: "shop" }],
    ]);
    return;
  }

  const counts = await stockCounts([product.id]);
  const stock = counts.get(product.id) ?? 0;
  const sold = await soldCount(product.id);
  const now = effectivePrice(product);
  const base = Number(product.price);
  const categories = await listCategories();
  const categoryIndex = categories.indexOf(product.category);

  const lines = [
    `${product.emoji ?? "📦"} <b>${esc(product.name)}</b>`,
    now < base
      ? `💰 Price: <b>${formatPrice(now)}</b> / code  <s>${formatPrice(base)}</s>  🔥 ${Math.round(((base - now) / base) * 100)}% off`
      : `💰 Price: <b>${formatPrice(now)}</b> / code`,
    `📦 Stock: <b>${stock}</b>`,
    `📈 Sold: <b>${sold}</b>`,
  ];
  if (product.description) lines.push("", `<blockquote>${esc(product.description)}</blockquote>`);
  if (product.delivery_note)
    lines.push(
      "",
      "Delivery instructions:",
      `<blockquote>${esc(product.delivery_note)}</blockquote>`,
    );
  lines.push("", "<i>Delivery is automatic after payment confirmation.</i>");

  const buy: InlineButton[] =
    stock > 0
      ? [{ text: "🛒 Buy Now", callback_data: `buy:${product.slug}` }]
      : [{ text: "🔕 Out of stock", callback_data: "shop" }];

  await render(view, lines.join("\n"), [
    buy,
    [
      {
        text: "⬅️ Back to Store",
        callback_data: categoryIndex >= 0 ? `cat:${categoryIndex}:0` : "shop",
      },
      { text: "🏠 Main Menu", callback_data: "menu" },
    ],
  ]);
}

// --------------------------------------------------------------- checkout UI

/** Payment methods, configured from the dashboard as "Label | instructions" lines. */
export async function paymentMethods(): Promise<{ label: string; instructions: string }[]> {
  const raw = await setting("payment_methods", "");
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [label, ...rest] = line.split("|");
      return {
        label: (label ?? "").trim() || "Payment",
        instructions: rest.join("|").trim(),
      };
    })
    .slice(0, 10);
}

const QUANTITIES = [1, 2, 3, 5, 10, 15, 20, 25];

export async function quantityScreen(view: View, slug: string): Promise<void> {
  const { data } = await supabaseAdmin
    .from("products")
    .select("id, slug, name, emoji, category, price, sale_price, sale_ends_at, description, delivery_note, active")
    .eq("slug", slug)
    .maybeSingle();
  const product = data as (ProductRow & { active: boolean }) | null;
  if (!product || !product.active) {
    await render(view, "❌ <b>That product is not available.</b>", [
      [{ text: "🛍 Shop", callback_data: "shop" }],
    ]);
    return;
  }
  const stock = (await stockCounts([product.id])).get(product.id) ?? 0;
  if (stock === 0) {
    await render(view, "😔 <b>That product just sold out.</b>", [
      [{ text: "🛍 Shop", callback_data: "shop" }],
    ]);
    return;
  }
  const price = effectivePrice(product);
  const options = QUANTITIES.filter((q) => q <= stock);
  if (options.length === 0) options.push(stock);

  const rows: InlineButton[][] = [];
  for (let i = 0; i < options.length; i += 4) {
    rows.push(
      options.slice(i, i + 4).map((q) => ({
        text: String(q),
        callback_data: `qty:${product.slug}:${q}`,
      })),
    );
  }
  if (stock > 1 && !options.includes(stock))
    rows.push([{ text: `Max (${stock})`, callback_data: `qty:${product.slug}:${stock}` }]);
  rows.push([
    { text: "⬅️ Back", callback_data: `product:${product.slug}` },
    { text: "🏠 Main Menu", callback_data: "menu" },
  ]);

  await render(
    view,
    [
      "🧮 <b>Select Quantity</b>",
      "",
      `${product.emoji ?? "📦"} <b>${esc(product.name)}</b>`,
      `${formatPrice(price)} / code · ${stock} in stock`,
      "",
      "How many codes do you want?",
    ].join("\n"),
    rows,
  );
}

export async function summaryScreen(
  view: View,
  user: ShopUser,
  slug: string,
  qty: number,
): Promise<void> {
  const { data } = await supabaseAdmin
    .from("products")
    .select("id, slug, name, emoji, category, price, sale_price, sale_ends_at, description, delivery_note, active")
    .eq("slug", slug)
    .maybeSingle();
  const product = data as (ProductRow & { active: boolean }) | null;
  if (!product || !product.active) {
    await render(view, "❌ <b>That product is not available.</b>", [
      [{ text: "🛍 Shop", callback_data: "shop" }],
    ]);
    return;
  }
  const stock = (await stockCounts([product.id])).get(product.id) ?? 0;
  if (qty > stock) {
    await render(view, `😔 <b>Only ${stock} left.</b> Pick a smaller quantity.`, [
      [{ text: "⬅️ Back", callback_data: `buy:${product.slug}` }],
    ]);
    return;
  }
  const price = effectivePrice(product);
  const total = price * qty;
  const { data: me } = await supabaseAdmin
    .from("bot_users")
    .select("balance")
    .eq("id", user.id)
    .maybeSingle();
  const balance = Number(me?.balance ?? 0);

  const rows: InlineButton[][] = [];
  if (balance >= total)
    rows.push([
      { text: `💵 Pay from balance (${formatPrice(balance)})`, callback_data: `paybal:${slug}:${qty}` },
    ]);
  rows.push([{ text: "💳 Choose payment method", callback_data: `pm:${slug}:${qty}` }]);
  rows.push([
    { text: "⬅️ Back", callback_data: `buy:${slug}` },
    { text: "🚫 Cancel", callback_data: `product:${slug}` },
  ]);

  await render(
    view,
    [
      "🧾 <b>Order Summary</b>",
      "",
      `${product.emoji ?? "📦"} <b>${esc(product.name)}</b>`,
      `🔢 Qty: <b>${qty}</b>`,
      `💰 Price: <b>${formatPrice(price)}</b> each`,
      `🧮 Total: <b>${formatPrice(total)}</b>`,
      "",
      `👛 Your balance: ${formatPrice(balance)}`,
      "",
      "Choose a payment method:",
    ].join("\n"),
    rows,
  );
}

export async function methodsScreen(view: View, slug: string, qty: number): Promise<void> {
  const methods = await paymentMethods();
  const { data } = await supabaseAdmin
    .from("products")
    .select("name, emoji, price, sale_price, sale_ends_at")
    .eq("slug", slug)
    .maybeSingle();
  const product = data as
    | {
        name: string;
        emoji: string | null;
        price: number | string;
        sale_price: number | string | null;
        sale_ends_at: string | null;
      }
    | null;
  if (!product) {
    await render(view, "❌ <b>That product is not available.</b>", [
      [{ text: "🛍 Shop", callback_data: "shop" }],
    ]);
    return;
  }
  const total = effectivePrice(product) * qty;

  if (methods.length === 0) {
    await render(
      view,
      "💳 <b>No payment methods are set up yet.</b>\n\nPlease contact support to complete this order.",
      [[{ text: "🆘 Support", callback_data: "support" }], [{ text: "🏠 Main Menu", callback_data: "menu" }]],
    );
    return;
  }

  const rows: InlineButton[][] = methods.map((m, index) => [
    { text: `💠 ${m.label}`, callback_data: `pmx:${slug}:${qty}:${index}` },
  ]);
  rows.push([
    { text: "⬅️ Back", callback_data: `qty:${slug}:${qty}` },
    { text: "🚫 Cancel Order", callback_data: `product:${slug}` },
  ]);

  await render(
    view,
    [
      "💳 <b>Select Payment Method</b>",
      "",
      `${product.emoji ?? "📦"} <b>${esc(product.name)}</b> × ${qty}`,
      `Total: <b>${formatPrice(total)}</b>`,
    ].join("\n"),
    rows,
  );
}

export async function ordersScreen(view: View, user: ShopUser): Promise<void> {
  const { data } = await supabaseAdmin
    .from("orders")
    .select("id, status, total_price, created_at, products(name, emoji)")
    .eq("bot_user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(10);

  const rows = data ?? [];
  if (rows.length === 0) {
    await render(view, "🧾 <b>You have no orders yet.</b>\n\nTap Shop to see what's in stock.", [
      [{ text: "🛍 Shop", callback_data: "shop" }],
      [{ text: "🏠 Menu", callback_data: "menu" }],
    ]);
    return;
  }

  const icon: Record<string, string> = {
    pending: "⏳",
    paid: "💳",
    delivered: "✅",
    cancelled: "❌",
    refunded: "↩️",
  };
  const lines = ["🧾 <b>Your latest orders</b>", ""];
  for (const o of rows) {
    const p = (o as { products: { name: string; emoji: string | null } | null }).products;
    const when = new Date(o.created_at as string).toISOString().slice(0, 10);
    lines.push(
      `${icon[o.status as string] ?? "•"} <code>${String(o.id).slice(0, 8)}</code> · ${esc(p?.name ?? "item")} · ${formatPrice(o.total_price as number)} · ${o.status} · ${when}`,
    );
  }
  await render(view, lines.join("\n"), navRow());
}

export async function balanceScreen(view: View, user: ShopUser): Promise<void> {
  const [{ data: me }, { data: tx }] = await Promise.all([
    supabaseAdmin.from("bot_users").select("balance").eq("id", user.id).maybeSingle(),
    supabaseAdmin
      .from("wallet_transactions")
      .select("amount, reason, created_at")
      .eq("bot_user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  const lines = [
    `💰 <b>Balance: ${formatPrice(Number(me?.balance ?? 0))}</b>`,
    "",
    "Balance is topped up by an admin (and refunds land here). It is spent automatically at checkout.",
  ];
  if ((tx ?? []).length > 0) {
    lines.push("", "<b>Recent activity</b>");
    for (const t of tx ?? []) {
      const amount = Number(t.amount);
      lines.push(
        `${amount >= 0 ? "➕" : "➖"} ${formatPrice(Math.abs(amount))} · ${esc(String(t.reason))}`,
      );
    }
  }
  await render(view, lines.join("\n"), navRow());
}

export async function supportScreen(view: View): Promise<void> {
  const contact = await setting("support_contact", "");
  await render(
    view,
    contact
      ? `🆘 <b>Support</b>\n\nContact: ${esc(contact)}\n\nInclude your order id so we can help faster.`
      : "🆘 <b>Support</b>\n\nA support contact has not been set up yet.",
    navRow(),
  );
}

export async function howItWorksScreen(view: View): Promise<void> {
  const instructions = await setting(
    "payment_instructions",
    "Send payment and reply with your transaction reference. An admin will confirm it shortly.",
  );
  await render(
    view,
    [
      "ℹ️ <b>How it works</b>",
      "",
      "1️⃣ Pick a category and open a product.",
      "2️⃣ Tap Buy — one unit is reserved for you straight away, so nobody else can take it.",
      "3️⃣ If your balance covers the price, the item is delivered instantly.",
      "4️⃣ Otherwise pay and an admin confirms your order, then it is delivered here in chat.",
      "",
      `<b>Payment</b>\n${esc(instructions)}`,
    ].join("\n"),
    navRow(),
  );
}
