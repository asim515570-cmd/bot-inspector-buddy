import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { SLUG_PATTERN } from "@/lib/telegram/validation";

export type AdminProduct = {
  id: string;
  slug: string;
  name: string;
  emoji: string | null;
  description: string | null;
  price: number;
  sale_price: number | null;
  sale_ends_at: string | null;
  category: string;
  delivery_note: string | null;
  sort_order: number;
  active: boolean;
  stock: { available: number; reserved: number; delivered: number };
};

type Ctx = { userId: string; claims?: unknown };

async function security() {
  return import("@/lib/security.server");
}

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/**
 * Verifies the caller holds the admin role, reading it fresh from the database
 * on every call. There is no self-service bootstrap: roles are only granted by
 * an existing administrator.
 */
async function assertAdmin(context: Ctx) {
  await (await security()).assertAdmin(context);
}

async function assertAdminAction(context: Ctx, action: string, limit = 30) {
  await (await security()).assertAdminAction(context, action, { limit });
}

async function audit(context: Ctx, action: string, detail?: string) {
  const s = await security();
  await s.logActivity(s.actorOf(context), action, detail);
}

function dbFail(error: unknown, friendly = "Something went wrong. Please try again."): Error {
  const message =
    error && typeof error === "object" && "message" in error
      ? String((error as { message: unknown }).message)
      : String(error);
  console.error(`[db] ${message}`);
  return new Error(friendly);
}

const slug = z.string().trim().toLowerCase().regex(SLUG_PATTERN, "Invalid slug");
const price = z.number().nonnegative().max(1_000_000);

export const getAdminStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    try {
      await assertAdmin(context);
      return { isAdmin: true as const };
    } catch {
      return { isAdmin: false as const };
    }
  });

export const listProducts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AdminProduct[]> => {
    await assertAdmin(context);
    const db = await admin();
    const [{ data: products, error }, { data: stock }] = await Promise.all([
      db
        .from("products")
        .select("id, slug, name, emoji, description, price, sale_price, sale_ends_at, category, delivery_note, sort_order, active")
        .order("created_at", { ascending: false }),
      db.from("stock_items").select("product_id, status"),
    ]);
    if (error) throw dbFail(error);
    return (products ?? []).map((p) => {
      const rows = (stock ?? []).filter((s) => s.product_id === p.id);
      return {
        ...p,
        price: Number(p.price),
        sale_price: p.sale_price === null ? null : Number(p.sale_price),
        stock: {
          available: rows.filter((r) => r.status === "available").length,
          reserved: rows.filter((r) => r.status === "reserved").length,
          delivered: rows.filter((r) => r.status === "delivered").length,
        },
      };
    });
  });

export const saveProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid().optional(),
        slug,
        name: z.string().trim().min(1).max(80),
        emoji: z.string().trim().max(16).nullable(),
        description: z.string().trim().max(1000).nullable(),
        price,
        sale_price: z.number().nonnegative().max(1_000_000).nullable(),
        sale_ends_at: z.string().trim().min(1).nullable(),
        category: z.string().trim().min(1).max(40),
        delivery_note: z.string().trim().max(1000).nullable(),
        sort_order: z.number().int().min(0).max(9999),
        active: z.boolean(),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    await assertAdminAction(context, "product:save", 40);
    const db = await admin();

    if (data.active) {
      // Only allow activating a product that has stock to sell.
      const query = data.id
        ? db.from("stock_items").select("id", { count: "exact", head: true }).eq("product_id", data.id).eq("status", "available")
        : null;
      const count = query ? (await query).count ?? 0 : 0;
      if (count === 0) {
        throw new Error("Add at least one stock item before making this product visible to customers.");
      }
    }

    const row = {
      slug: data.slug,
      name: data.name,
      emoji: data.emoji || null,
      description: data.description || null,
      price: data.price,
      sale_price: data.sale_price && data.sale_price > 0 ? data.sale_price : null,
      sale_ends_at: data.sale_ends_at ? new Date(data.sale_ends_at).toISOString() : null,
      category: data.category,
      delivery_note: data.delivery_note || null,
      sort_order: data.sort_order,
      active: data.active,
    };

    if (data.id) {
      const { error } = await db.from("products").update(row).eq("id", data.id);
      if (error) throw dbFail(error, "Could not save this product. Check the fields and try again.");
      await audit(context, "product:update", `${data.slug} (${data.id})`);
      return { id: data.id };
    }
    const { data: created, error } = await db.from("products").insert(row).select("id").single();
    if (error) {
      throw dbFail(
        error,
        String((error as { message?: string }).message ?? "").includes("duplicate")
          ? "That slug is already used by another product."
          : "Could not create this product. Check the fields and try again.",
      );
    }
    await audit(context, "product:create", `${data.slug} (${created.id})`);
    return { id: created.id };
  });

export const deleteProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    await assertAdminAction(context, "product:delete", 20);
    const db = await admin();
    const { count } = await db
      .from("stock_items")
      .select("id", { count: "exact", head: true })
      .eq("product_id", data.id)
      .in("status", ["reserved", "delivered"]);

    if ((count ?? 0) > 0) {
      const { error } = await db.from("products").update({ active: false }).eq("id", data.id);
      if (error) throw dbFail(error, "Could not hide this product. Please try again.");
      await audit(context, "product:hide", data.id);
      return { deleted: false as const, message: "This product has sold or reserved stock, so it was hidden instead of deleted." };
    }
    await db.from("stock_items").delete().eq("product_id", data.id).eq("status", "available");
    const { error } = await db.from("products").delete().eq("id", data.id);
    if (error) throw dbFail(error, "Could not delete this product. Please try again.");
    await audit(context, "product:delete", data.id);
    return { deleted: true as const, message: "Product deleted." };
  });

export const addStock = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ productId: z.string().uuid(), payloads: z.string().min(1).max(50_000) }).parse(d),
  )
  .handler(async ({ context, data }) => {
    await assertAdminAction(context, "stock:add", 30);
    const lines = data.payloads
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, 500);
    if (lines.length === 0) throw new Error("Enter at least one stock item, one per line.");
    const db = await admin();
    const { error } = await db
      .from("stock_items")
      .insert(lines.map((payload) => ({ product_id: data.productId, payload, status: "available" as const })));
    if (error) throw dbFail(error, "Could not add these stock items. Please try again.");
    // Codes themselves are never written to the audit trail.
    await audit(context, "stock:add", `${lines.length} item(s) → ${data.productId}`);
    return { added: lines.length };
  });

export const listStock = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ productId: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    await assertAdmin(context);
    const db = await admin();
    const { data: rows, error } = await db
      .from("stock_items")
      .select("id, payload, status, delivered_at, created_at")
      .eq("product_id", data.productId)
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw dbFail(error);
    return rows ?? [];
  });

export const deleteStockItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    await assertAdminAction(context, "stock:delete", 60);
    const db = await admin();
    const { data: row } = await db.from("stock_items").select("status").eq("id", data.id).maybeSingle();
    if (!row) throw new Error("That stock item no longer exists.");
    if (row.status !== "available") throw new Error("Only unsold stock can be removed.");
    const { error } = await db.from("stock_items").delete().eq("id", data.id).eq("status", "available");
    if (error) throw dbFail(error, "Could not remove this stock item. Please try again.");
    await audit(context, "stock:delete", data.id);
    return { ok: true };
  });

export const clearAvailableStock = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ productId: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    await assertAdminAction(context, "stock:clear", 10);
    const db = await admin();
    const { error, count } = await db
      .from("stock_items")
      .delete({ count: "exact" })
      .eq("product_id", data.productId)
      .eq("status", "available");
    if (error) throw dbFail(error, "Could not clear stock. Please try again.");
    await audit(context, "stock:clear", `${count ?? 0} removed from ${data.productId}`);
    return { removed: count ?? 0 };
  });
