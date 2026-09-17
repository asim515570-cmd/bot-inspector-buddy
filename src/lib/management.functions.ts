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
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    const db = await admin();
    const rows = Object.entries(data).map(([key, value]) => ({ key, value }));
    const { error } = await db.from("shop_settings").upsert(rows, { onConflict: "key" });
    if (error) throw new Error(error.message);
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
    return { message: data.approve ? "Payout approved." : "Payout rejected and refunded." };
  });
