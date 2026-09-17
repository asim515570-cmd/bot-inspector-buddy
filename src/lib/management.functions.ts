/**
 * Shop management server functions: dashboard stats, orders, customers,
 * wallet ledger and shop settings.
 *
 * Every function re-checks the caller's admin role on the server, on every
 * call. Nothing is trusted from the client.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function assertAdmin(userId: string) {
  const db = await admin();
  const { data } = await db
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (!data) throw new Error("Not authorized. This account is not an administrator.");
}

/** Records an admin action for the dashboard activity feed. Never throws. */
async function logActivity(actor: string, action: string, detail?: string) {
  try {
    const db = await admin();
    await db.from("admin_activity").insert({ actor, action, detail: detail ?? null });
  } catch {
    // The audit trail must never break the action it describes.
  }
}

function actorOf(context: { userId: string; claims?: unknown }) {
  const claims = context.claims as { email?: string } | undefined;
  return claims?.email ?? context.userId;
}

export type OrderRow = {
  id: string;
  status: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  payment_method: string | null;
  payment_reference: string | null;
  admin_note: string | null;
  created_at: string;
  paid_at: string | null;
  delivered_at: string | null;
  product: { name: string; slug: string; emoji: string | null } | null;
  customer: { telegram_id: number; username: string | null; first_name: string | null } | null;
};

export type CustomerRow = {
  id: string;
  telegram_id: number;
  username: string | null;
  first_name: string | null;
  role: "admin" | "customer";
  balance: number;
  is_blocked: boolean;
  created_at: string;
  orders: number;
  spent: number;
};

export const getDashboardStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const db = await admin();
    const [products, activeProducts, customers, stock, orders, payouts] = await Promise.all([
      db.from("products").select("id", { count: "exact", head: true }),
      db.from("products").select("id", { count: "exact", head: true }).eq("active", true),
      db.from("bot_users").select("id", { count: "exact", head: true }),
      db.from("stock_items").select("status"),
      db.from("orders").select("status, total_price"),
      db
        .from("withdrawals")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending"),
    ]);
    const stockRows = stock.data ?? [];
    const orderRows = orders.data ?? [];
    return {
      products: products.count ?? 0,
      activeProducts: activeProducts.count ?? 0,
      customers: customers.count ?? 0,
      availableStock: stockRows.filter((s) => s.status === "available").length,
      pendingOrders: orderRows.filter((o) => o.status === "pending").length,
      paidOrders: orderRows.filter((o) => o.status === "paid").length,
      deliveredOrders: orderRows.filter((o) => o.status === "delivered").length,
      pendingWithdrawals: payouts.count ?? 0,
      revenue: orderRows
        .filter((o) => o.status === "delivered" || o.status === "paid")
        .reduce((sum, o) => sum + Number(o.total_price ?? 0), 0),
    };
  });

export const listOrders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        status: z.enum(["all", "pending", "paid", "delivered", "cancelled", "refunded"]).default("all"),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ context, data }): Promise<OrderRow[]> => {
    await assertAdmin(context.userId);
    const db = await admin();
    let query = db
      .from("orders")
      .select(
        "id, status, quantity, unit_price, total_price, payment_method, payment_reference, admin_note, created_at, paid_at, delivered_at, products(name, slug, emoji), bot_users(telegram_id, username, first_name)",
      )
      .order("created_at", { ascending: false })
      .limit(300);
    if (data.status !== "all") query = query.eq("status", data.status);
    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);
    return (rows ?? []).map((r) => {
      const { products, bot_users, ...rest } = r as typeof r & {
        products: OrderRow["product"];
        bot_users: OrderRow["customer"];
      };
      return {
        ...rest,
        unit_price: Number(rest.unit_price),
        total_price: Number(rest.total_price),
        product: products ?? null,
        customer: bot_users ?? null,
      } as OrderRow;
    });
  });

/**
 * Moves an order through its lifecycle. Delivering hands the reserved stock
 * item to the buyer in Telegram; cancelling or refunding returns the item to
 * available stock so it can be sold again.
 */
export const updateOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        action: z.enum(["mark_paid", "deliver", "cancel", "refund"]),
        note: z.string().trim().max(500).optional(),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    const db = await admin();
    const { data: order } = await db
      .from("orders")
      .select("id, status, total_price, bot_users(telegram_id), products(name, emoji)")
      .eq("id", data.id)
      .maybeSingle();
    if (!order) throw new Error("That order no longer exists.");
    await logActivity(actorOf(context), `order:${data.action}`, data.id);

    const chatId = (order as { bot_users: { telegram_id: number } | null }).bot_users?.telegram_id;
    const productName =
      (order as { products: { name: string } | null }).products?.name ?? "your order";
    const note = data.note ? { admin_note: data.note } : {};

    if (data.action === "mark_paid") {
      if (order.status !== "pending") throw new Error("Only pending orders can be marked as paid.");
      const { error } = await db
        .from("orders")
        .update({ status: "paid", paid_at: new Date().toISOString(), ...note })
        .eq("id", data.id);
      if (error) throw new Error(error.message);
      if (chatId) {
        const { sendMessage } = await import("@/lib/telegram/gateway.server");
        await sendMessage(chatId, `✅ Payment confirmed for ${productName}. Delivery is on its way.`);
      }
      return { message: "Order marked as paid." };
    }

    if (data.action === "deliver") {
      if (order.status === "delivered") throw new Error("This order was already delivered.");
      if (order.status === "cancelled" || order.status === "refunded")
        throw new Error("This order is closed and cannot be delivered.");
      const { data: delivered, error } = await db.rpc("deliver_order", { p_order: data.id });
      if (error) throw new Error(error.message);
      const payloads = (delivered ?? []).map((r: { payload: string }) => r.payload);
      // Referral commission is paid once, when the order actually completes.
      const { data: percentRow } = await db
        .from("shop_settings")
        .select("value")
        .eq("key", "referral_percent")
        .maybeSingle();
      const percent = Number(percentRow?.value ?? 5);
      if (percent > 0) {
        const { data: commission } = await db.rpc("pay_referral_commission", {
          p_order: data.id,
          p_percent: percent,
        });
        if (Number(commission ?? 0) > 0) {
          const { data: refUser } = await db
            .from("orders")
            .select("bot_users!inner(referred_by)")
            .eq("id", data.id)
            .maybeSingle();
          const referrerId = (refUser as { bot_users: { referred_by: string | null } } | null)
            ?.bot_users?.referred_by;
          if (referrerId) {
            const { data: referrer } = await db
              .from("bot_users")
              .select("telegram_id, balance")
              .eq("id", referrerId)
              .maybeSingle();
            if (referrer) {
              const { sendMessage } = await import("@/lib/telegram/gateway.server");
              await sendMessage(
                referrer.telegram_id,
                `🎉 Referral bonus: +${Number(commission).toFixed(2)} added to your balance. New balance: ${Number(referrer.balance).toFixed(2)}`,
              );
            }
          }
        }
      }
      if (data.note) await db.from("orders").update(note).eq("id", data.id);
      if (chatId && payloads.length) {
        const { sendMessage } = await import("@/lib/telegram/gateway.server");
        await sendMessage(
          chatId,
          `📦 Your ${productName} is ready:\n\n${payloads.join("\n")}\n\nThank you for your order!`,
        );
      }
      return { message: payloads.length ? "Delivered and sent to the customer." : "Order closed, but no reserved item was found." };
    }

    const status = data.action === "cancel" ? "cancelled" : "refunded";
    const { error } = await db.rpc("release_order", { p_order: data.id, p_status: status });
    if (error) throw new Error(error.message);
    if (data.note) await db.from("orders").update(note).eq("id", data.id);

    if (data.action === "refund") {
      const { data: user } = await db
        .from("orders")
        .select("bot_user_id, total_price")
        .eq("id", data.id)
        .maybeSingle();
      if (user) {
        const { data: current } = await db
          .from("bot_users")
          .select("balance")
          .eq("id", user.bot_user_id)
          .maybeSingle();
        const next = Number(current?.balance ?? 0) + Number(user.total_price ?? 0);
        await db.from("bot_users").update({ balance: next }).eq("id", user.bot_user_id);
        await db.from("wallet_transactions").insert({
          bot_user_id: user.bot_user_id,
          amount: Number(user.total_price ?? 0),
          balance_after: next,
          reason: "Order refunded",
          order_id: data.id,
        });
      }
    }
    if (chatId) {
      const { sendMessage } = await import("@/lib/telegram/gateway.server");
      await sendMessage(
        chatId,
        status === "refunded"
          ? `↩️ ${productName} was refunded to your balance.`
          : `❌ Your order for ${productName} was cancelled.`,
      );
    }
    return { message: status === "refunded" ? "Order refunded." : "Order cancelled." };
  });

export const listCustomers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CustomerRow[]> => {
    await assertAdmin(context.userId);
    const db = await admin();
    const [{ data: users, error }, { data: orders }] = await Promise.all([
      db
        .from("bot_users")
        .select("id, telegram_id, username, first_name, role, balance, is_blocked, created_at")
        .order("created_at", { ascending: false })
        .limit(500),
      db.from("orders").select("bot_user_id, status, total_price"),
    ]);
    if (error) throw new Error(error.message);
    return (users ?? []).map((u) => {
      const mine = (orders ?? []).filter((o) => o.bot_user_id === u.id);
      return {
        ...u,
        balance: Number(u.balance),
        orders: mine.length,
        spent: mine
          .filter((o) => o.status === "delivered" || o.status === "paid")
          .reduce((s, o) => s + Number(o.total_price ?? 0), 0),
      } as CustomerRow;
    });
  });

export const updateCustomer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        role: z.enum(["admin", "customer"]).optional(),
        isBlocked: z.boolean().optional(),
        balanceDelta: z.number().min(-1_000_000).max(1_000_000).optional(),
        reason: z.string().trim().max(200).optional(),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    const db = await admin();
    const { data: user } = await db
      .from("bot_users")
      .select("id, balance, role")
      .eq("id", data.id)
      .maybeSingle();
    if (!user) throw new Error("That customer no longer exists.");

    const patch: {
      role?: "admin" | "customer";
      is_blocked?: boolean;
      balance?: number;
    } = {};
    if (data.role) patch.role = data.role;
    if (typeof data.isBlocked === "boolean") patch.is_blocked = data.isBlocked;

    if (data.balanceDelta) {
      const next = Number(user.balance) + data.balanceDelta;
      if (next < 0) throw new Error("That would take the balance below zero.");
      patch.balance = next;
    }

    if (Object.keys(patch).length === 0) return { message: "Nothing to change." };
    const { error } = await db.from("bot_users").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);

    if (data.balanceDelta) {
      await db.from("wallet_transactions").insert({
        bot_user_id: data.id,
        amount: data.balanceDelta,
        balance_after: Number(patch.balance),
        reason: data.reason || "Manual adjustment by admin",
      });
    }
    return { message: "Customer updated." };
  });

export const listWalletTransactions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ botUserId: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    const db = await admin();
    const { data: rows, error } = await db
      .from("wallet_transactions")
      .select("id, amount, balance_after, reason, created_at")
      .eq("bot_user_id", data.botUserId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return (rows ?? []).map((r) => ({
      ...r,
      amount: Number(r.amount),
      balance_after: Number(r.balance_after),
    }));
  });

export const getSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const db = await admin();
    const { data } = await db.from("shop_settings").select("key, value");
    const map: Record<string, string> = {};
    for (const row of data ?? []) map[row.key] = row.value;
    return map;
  });

export const saveSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        welcome_message: z.string().trim().max(1000),
        support_contact: z.string().trim().max(200),
        payment_instructions: z.string().trim().max(1000),
        payment_methods: z.string().trim().max(4000).optional(),
        referral_percent: z.string().trim().max(5).optional(),
        min_withdraw: z.string().trim().max(12).optional(),
        bot_username: z.string().trim().max(64).optional(),
        store_name: z.string().trim().max(120).optional(),
        channel_url: z.string().trim().max(300).optional(),
        group_url: z.string().trim().max(300).optional(),
        terms_url: z.string().trim().max(300).optional(),
        notice: z.string().trim().max(500).optional(),
        api_info: z.string().trim().max(1000).optional(),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    const db = await admin();
    const rows = Object.entries(data)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => ({ key, value: value as string }));
    const { error } = await db.from("shop_settings").upsert(rows, { onConflict: "key" });
    if (error) throw new Error(error.message);
    await logActivity(actorOf(context), "settings:save", `${rows.length} field(s)`);
    return { message: "Settings saved." };
  });

export const broadcast = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ text: z.string().trim().min(1).max(3000) }).parse(d),
  )
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    const db = await admin();
    const { data: users } = await db
      .from("bot_users")
      .select("telegram_id")
      .eq("is_blocked", false)
      .limit(2000);
    const { sendMessage } = await import("@/lib/telegram/gateway.server");
    let sent = 0;
    for (const u of users ?? []) {
      try {
        await sendMessage(u.telegram_id, data.text);
        sent += 1;
      } catch {
        // A single unreachable chat must not stop the broadcast.
      }
      await new Promise((r) => setTimeout(r, 40));
    }
    await logActivity(actorOf(context), "broadcast", `${sent} recipient(s)`);
    return { sent, total: (users ?? []).length };
  });


export type WithdrawalRow = {
  id: string;
  amount: number;
  method: string;
  address: string;
  status: string;
  admin_note: string | null;
  created_at: string;
  decided_at: string | null;
  customer: { telegram_id: number; username: string | null; first_name: string | null } | null;
};

export const listWithdrawals = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({ status: z.enum(["all", "pending", "approved", "rejected"]).default("all") })
      .parse(d ?? {}),
  )
  .handler(async ({ context, data }): Promise<WithdrawalRow[]> => {
    await assertAdmin(context.userId);
    const db = await admin();
    let query = db
      .from("withdrawals")
      .select(
        "id, amount, method, address, status, admin_note, created_at, decided_at, bot_users(telegram_id, username, first_name)",
      )
      .order("created_at", { ascending: false })
      .limit(200);
    if (data.status !== "all") query = query.eq("status", data.status);
    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);
    return (rows ?? []).map((r) => {
      const { bot_users, ...rest } = r as typeof r & { bot_users: WithdrawalRow["customer"] };
      return { ...rest, amount: Number(rest.amount), customer: bot_users ?? null } as WithdrawalRow;
    });
  });

/** Approves (pays out) or rejects (returns the held amount) a payout request. */
export const decideWithdrawal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        approve: z.boolean(),
        note: z.string().trim().max(500).optional(),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    const db = await admin();
    const { data: row } = await db
      .from("withdrawals")
      .select("id, amount, method, status, bot_users(telegram_id)")
      .eq("id", data.id)
      .maybeSingle();
    if (!row) throw new Error("That payout request no longer exists.");
    if (row.status !== "pending") throw new Error("This request was already decided.");

    const { error } = await db.rpc("decide_withdrawal", {
      p_withdrawal: data.id,
      p_approve: data.approve,
      p_note: data.note ?? "",
    });
    if (error) throw new Error(error.message);

    const chatId = (row as { bot_users: { telegram_id: number } | null }).bot_users?.telegram_id;
    if (chatId) {
      const { sendMessage } = await import("@/lib/telegram/gateway.server");
      await sendMessage(
        chatId,
        data.approve
          ? `✅ Payout approved: ${Number(row.amount).toFixed(2)} via ${row.method}.${data.note ? `\n${data.note}` : ""}`
          : `❌ Payout request rejected. ${Number(row.amount).toFixed(2)} has been returned to your balance.${data.note ? `\nReason: ${data.note}` : ""}`,
      );
    }
    await logActivity(actorOf(context), data.approve ? "payout:approve" : "payout:reject", data.id);
    return { message: data.approve ? "Payout approved." : "Payout rejected and refunded." };
  });

export type StockRow = {
  product_id: string;
  slug: string;
  name: string;
  emoji: string | null;
  price: number;
  active: boolean;
  available: number;
  reserved: number;
  delivered: number;
};

/** Stock levels for every product (counts only — payloads are never returned). */
export const listStockOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<StockRow[]> => {
    await assertAdmin(context.userId);
    const db = await admin();
    const [{ data: products }, { data: items }] = await Promise.all([
      db.from("products").select("id, slug, name, emoji, price, active").order("sort_order"),
      db.from("stock_items").select("product_id, status"),
    ]);
    return (products ?? []).map((p) => {
      const mine = (items ?? []).filter((i) => i.product_id === p.id);
      return {
        product_id: p.id,
        slug: p.slug,
        name: p.name,
        emoji: p.emoji,
        price: Number(p.price),
        active: p.active,
        available: mine.filter((i) => i.status === "available").length,
        reserved: mine.filter((i) => i.status === "reserved").length,
        delivered: mine.filter((i) => i.status === "delivered").length,
      };
    });
  });

export type ReferrerRow = {
  id: string;
  telegram_id: number;
  username: string | null;
  first_name: string | null;
  referral_code: string | null;
  referral_earned: number;
  invited: number;
};

/** Referral leaderboard: who invited how many people and earned how much. */
export const listReferrals = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ReferrerRow[]> => {
    await assertAdmin(context.userId);
    const db = await admin();
    const { data: users } = await db
      .from("bot_users")
      .select("id, telegram_id, username, first_name, referral_code, referral_earned, referred_by");
    const rows = users ?? [];
    return rows
      .map((u) => ({
        id: u.id,
        telegram_id: u.telegram_id,
        username: u.username,
        first_name: u.first_name,
        referral_code: u.referral_code,
        referral_earned: Number(u.referral_earned ?? 0),
        invited: rows.filter((r) => r.referred_by === u.id).length,
      }))
      .filter((u) => u.invited > 0 || u.referral_earned > 0)
      .sort((a, b) => b.referral_earned - a.referral_earned || b.invited - a.invited)
      .slice(0, 100);
  });

/** Live bot connection status: account, webhook target and pending updates. */
export const getBotStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const { telegramInfo } = await import("@/lib/telegram/gateway.server");
    const me = (await telegramInfo("getMe")) as
      | { result?: { username?: string; first_name?: string } }
      | null;
    const hook = (await telegramInfo("getWebhookInfo")) as
      | {
          result?: {
            url?: string;
            pending_update_count?: number;
            last_error_message?: string;
            last_error_date?: number;
          };
        }
      | null;
    return {
      connected: Boolean(me?.result?.username),
      username: me?.result?.username ?? null,
      name: me?.result?.first_name ?? null,
      webhookUrl: hook?.result?.url || null,
      pendingUpdates: hook?.result?.pending_update_count ?? 0,
      lastError: hook?.result?.last_error_message ?? null,
    };
  });

/** Re-publishes the bot's command menu from the app's command list. */
export const syncBotCommands = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const { registerBotCommands } = await import("@/lib/telegram/commands.server");
    const ok = await registerBotCommands();
    if (!ok) throw new Error("Telegram did not accept the command list. Check the bot connection.");
    return { message: "Bot command menu updated." };
  });


export type AnalyticsData = {
  days: { date: string; revenue: number; orders: number }[];
  topProducts: { name: string; emoji: string | null; units: number; revenue: number }[];
  statuses: { status: string; count: number }[];
  newCustomers7d: number;
  revenue7d: number;
  revenue30d: number;
  averageOrder: number;
};

/** Sales analytics for the dashboard overview: last 30 days of orders. */
export const getAnalytics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AnalyticsData> => {
    await assertAdmin(context.userId);
    const db = await admin();
    const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();

    const [ordersRes, customersRes] = await Promise.all([
      db
        .from("orders")
        .select("status, quantity, total_price, created_at, products(name, emoji)")
        .gte("created_at", since)
        .limit(5000),
      db
        .from("bot_users")
        .select("id", { count: "exact", head: true })
        .gte("created_at", new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString()),
    ]);

    type Row = {
      status: string;
      quantity: number | null;
      total_price: number | string | null;
      created_at: string;
      products: { name: string; emoji: string | null } | null;
    };
    const rows = (ordersRes.data ?? []) as unknown as Row[];
    const earning = (r: Row) => r.status === "paid" || r.status === "delivered";

    const dayMap = new Map<string, { revenue: number; orders: number }>();
    for (let i = 13; i >= 0; i--) {
      const key = new Date(Date.now() - i * 24 * 3600 * 1000).toISOString().slice(0, 10);
      dayMap.set(key, { revenue: 0, orders: 0 });
    }
    const productMap = new Map<string, { name: string; emoji: string | null; units: number; revenue: number }>();
    const statusMap = new Map<string, number>();
    let revenue7d = 0;
    let revenue30d = 0;
    let earningCount = 0;
    const sevenAgo = Date.now() - 7 * 24 * 3600 * 1000;

    for (const r of rows) {
      statusMap.set(r.status, (statusMap.get(r.status) ?? 0) + 1);
      const total = Number(r.total_price ?? 0);
      if (!earning(r)) continue;
      earningCount += 1;
      revenue30d += total;
      const ts = new Date(r.created_at).getTime();
      if (ts >= sevenAgo) revenue7d += total;
      const key = r.created_at.slice(0, 10);
      const day = dayMap.get(key);
      if (day) {
        day.revenue += total;
        day.orders += 1;
      }
      const name = r.products?.name ?? "Unknown";
      const entry = productMap.get(name) ?? { name, emoji: r.products?.emoji ?? null, units: 0, revenue: 0 };
      entry.units += Number(r.quantity ?? 1);
      entry.revenue += total;
      productMap.set(name, entry);
    }

    return {
      days: [...dayMap.entries()].map(([date, v]) => ({ date, ...v })),
      topProducts: [...productMap.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 8),
      statuses: [...statusMap.entries()].map(([status, count]) => ({ status, count })),
      newCustomers7d: customersRes.count ?? 0,
      revenue7d,
      revenue30d,
      averageOrder: earningCount ? revenue30d / earningCount : 0,
    };
  });

export type ActivityRow = {
  id: string;
  actor: string;
  action: string;
  detail: string | null;
  created_at: string;
};

/** Recent admin actions (audit trail) for the dashboard. */
export const listActivity = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ActivityRow[]> => {
    await assertAdmin(context.userId);
    const db = await admin();
    const { data, error } = await db
      .from("admin_activity")
      .select("id, actor, action, detail, created_at")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return (data ?? []) as ActivityRow[];
  });
