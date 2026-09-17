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
}): number {
  const base = Number(p.price);
  const sale = p.sale_price === null ? null : Number(p.sale_price);
  return sale !== null && sale > 0 && sale < base ? sale : base;
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
  const [welcome, { data: me }, { count: orderCount }, { count: productCount }] =
    await Promise.all([
      setting("welcome_message", "Welcome to the shop!"),
      supabaseAdmin.from("bot_users").select("balance").eq("id", user.id).maybeSingle(),
      supabaseAdmin
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("bot_user_id", user.id),
      supabaseAdmin
        .from("products")
        .select("id", { count: "exact", head: true })
        .eq("active", true),
    ]);

  const text = [
    `🛍 <b>${esc(welcome)}</b>`,
    "",
    `💰 Balance: <b>${formatPrice(Number(me?.balance ?? 0))}</b>`,
    `🧾 Orders: <b>${orderCount ?? 0}</b>`,
    `📦 Products in shop: <b>${productCount ?? 0}</b>`,
    "",
    "<i>Instant delivery · stock checked in real time</i>",
  ].join("\n");

  await render(view, text, [
    [{ text: "🛍 Browse Shop", callback_data: "shop" }],
    [
      { text: "🧾 My Orders", callback_data: "orders" },
      { text: "💰 Balance", callback_data: "balance" },
    ],
    [
      { text: "🤝 Refer & earn", callback_data: "refer" },
      { text: "🏦 Withdraw", callback_data: "withdraw" },
    ],
    [
      { text: "🆘 Support", callback_data: "support" },
      { text: "ℹ️ How it works", callback_data: "how" },
    ],
  ]);
}

export async function categoriesScreen(view: View): Promise<void> {
  const categories = await listCategories();
  if (categories.length === 0) {
    await render(view, "😴 <b>No products are available right now.</b>\n\nCheck back soon.", [
      [{ text: "🏠 Menu", callback_data: "menu" }],
    ]);
    return;
  }

  const { data } = await supabaseAdmin
    .from("products")
    .select("id, category, price, sale_price")
    .eq("active", true);
  const rows = (data ?? []) as ProductRow[];
  const counts = await stockCounts(rows.map((r) => r.id));

  const lines: string[] = ["🛍 <b>Choose a category</b>", ""];
  const buttons: InlineButton[][] = [];
  categories.forEach((cat, index) => {
    const inCat = rows.filter((r) => r.category === cat);
    const inStock = inCat.filter((r) => (counts.get(r.id) ?? 0) > 0).length;
    const cheapest = Math.min(...inCat.map((r) => effectivePrice(r)));
    lines.push(
      `• <b>${esc(cat)}</b> — ${inCat.length} item(s), ${inStock} in stock, from ${formatPrice(cheapest)}`,
    );
    buttons.push([
      { text: `${esc(cat)} (${inCat.length})`, callback_data: `cat:${index}:0` },
    ]);
  });

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
    .select("id, slug, name, emoji, category, price, sale_price, description, delivery_note", {
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

  const lines = [`🛍 <b>${esc(category)}</b>  <i>(page ${page + 1}/${pages})</i>`, ""];
  const buttons: InlineButton[][] = [];
  for (const p of products) {
    const stock = counts.get(p.id) ?? 0;
    const badge = stock > 0 ? `${stock} in stock` : "out of stock";
    const sale = effectivePrice(p) < Number(p.price) ? " 🔥" : "";
    lines.push(
      `${p.emoji ?? "•"} <b>${esc(p.name)}</b>${sale}\n   ${priceLabel(p)} · ${badge}`,
    );
    buttons.push([
      {
        text: `${p.emoji ? `${p.emoji} ` : ""}${p.name} — ${formatPrice(effectivePrice(p))}`,
        callback_data: `product:${p.slug}`,
      },
    ]);
  }

  const nav: InlineButton[] = [];
  if (page > 0) nav.push({ text: "« Prev", callback_data: `cat:${categoryIndex}:${page - 1}` });
  if (from + PAGE_SIZE < total)
    nav.push({ text: "Next »", callback_data: `cat:${categoryIndex}:${page + 1}` });
  if (nav.length) buttons.push(nav);
  buttons.push([
    { text: "⬅️ Categories", callback_data: "shop" },
    { text: "🏠 Menu", callback_data: "menu" },
  ]);

  await render(view, lines.join("\n"), buttons);
}

export async function productScreen(view: View, slug: string): Promise<void> {
  const { data } = await supabaseAdmin
    .from("products")
    .select("id, slug, name, emoji, category, price, sale_price, description, delivery_note, active")
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
  const now = effectivePrice(product);
  const base = Number(product.price);
  const categories = await listCategories();
  const categoryIndex = categories.indexOf(product.category);

  const lines = [
    `${product.emoji ?? "📦"} <b>${esc(product.name)}</b>`,
    `<i>${esc(product.category)}</i>`,
    "",
    product.description ? esc(product.description) : "",
    "",
    now < base
      ? `💵 Price: <b>${formatPrice(now)}</b>  <s>${formatPrice(base)}</s>  🔥 ${Math.round(((base - now) / base) * 100)}% off`
      : `💵 Price: <b>${formatPrice(now)}</b>`,
    stock > 0 ? `📦 Available: <b>${stock}</b>` : "📦 <b>Out of stock</b>",
    product.delivery_note ? `🚚 ${esc(product.delivery_note)}` : "",
  ].filter((l) => l !== "");

  const buy: InlineButton[] =
    stock > 0
      ? [{ text: `🛒 Buy — ${formatPrice(now)}`, callback_data: `buy:${product.slug}` }]
      : [{ text: "🔕 Out of stock", callback_data: "shop" }];

  await render(view, lines.join("\n"), [
    buy,
    [
      {
        text: "⬅️ Back",
        callback_data: categoryIndex >= 0 ? `cat:${categoryIndex}:0` : "shop",
      },
      { text: "🏠 Menu", callback_data: "menu" },
    ],
  ]);
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
