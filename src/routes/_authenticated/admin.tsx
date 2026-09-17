import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import {
  getAdminStatus,
  listProducts,
  saveProduct,
  deleteProduct,
  addStock,
  listStock,
  deleteStockItem,
  clearAvailableStock,
  type AdminProduct,
} from "@/lib/admin.functions";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { WithdrawalsPanel } from "@/components/admin/WithdrawalsPanel";
import { StatsBar } from "@/components/admin/StatsBar";
import { OrdersPanel } from "@/components/admin/OrdersPanel";
import { CustomersPanel } from "@/components/admin/CustomersPanel";
import { SettingsPanel } from "@/components/admin/SettingsPanel";
import { StockPanel } from "@/components/admin/StockPanel";
import { ReferralsPanel } from "@/components/admin/ReferralsPanel";
import { BotPanel } from "@/components/admin/BotPanel";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({
    meta: [
      { title: "Products & stock — Shop Admin" },
      { name: "description", content: "Add, edit and delete products and stock for the Telegram shop." },
      { property: "og:title", content: "Products & stock — Shop Admin" },
      { property: "og:description", content: "Add, edit and delete products and stock for the Telegram shop." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminPage,
});

type Draft = {
  id?: string;
  slug: string;
  name: string;
  emoji: string;
  description: string;
  price: string;
  salePrice: string;
  saleEndsAt: string;
  category: string;
  deliveryNote: string;
  sortOrder: string;
  active: boolean;
};

const emptyDraft: Draft = {
  slug: "",
  name: "",
  emoji: "",
  description: "",
  price: "",
  salePrice: "",
  saleEndsAt: "",
  category: "General",
  deliveryNote: "",
  sortOrder: "100",
  active: false,
};

function AdminPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const status = useServerFn(getAdminStatus);
  const fetchProducts = useServerFn(listProducts);
  const save = useServerFn(saveProduct);
  const remove = useServerFn(deleteProduct);
  const addStockFn = useServerFn(addStock);
  const fetchStock = useServerFn(listStock);
  const removeStockItem = useServerFn(deleteStockItem);
  const clearStock = useServerFn(clearAvailableStock);

  const [draft, setDraft] = useState<Draft | null>(null);
  const [stockFor, setStockFor] = useState<AdminProduct | null>(null);
  const [stockText, setStockText] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<AdminProduct | null>(null);

  const adminQuery = useQuery({ queryKey: ["admin-status"], queryFn: () => status() });
  const productsQuery = useQuery({
    queryKey: ["admin-products"],
    queryFn: () => fetchProducts(),
    enabled: adminQuery.data?.isAdmin === true,
  });
  const stockQuery = useQuery({
    queryKey: ["admin-stock", stockFor?.id],
    queryFn: () => fetchStock({ data: { productId: stockFor!.id } }),
    enabled: !!stockFor,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["admin-products"] });
    qc.invalidateQueries({ queryKey: ["admin-stock"] });
  };
  const onError = (e: unknown) => toast.error(e instanceof Error ? e.message : "Something went wrong.");

  const saveMutation = useMutation({
    mutationFn: (d: Draft) =>
      save({
        data: {
          id: d.id,
          slug: d.slug.trim().toLowerCase(),
          name: d.name.trim(),
          emoji: d.emoji.trim() || null,
          description: d.description.trim() || null,
          price: Number(d.price),
          sale_price: d.salePrice.trim() ? Number(d.salePrice) : null,
          sale_ends_at: d.saleEndsAt.trim() || null,
          category: d.category.trim() || "General",
          delivery_note: d.deliveryNote.trim() || null,
          sort_order: Number(d.sortOrder) || 100,
          active: d.active,
        },
      }),
    onSuccess: () => {
      toast.success("Product saved.");
      setDraft(null);
      invalidate();
    },
    onError,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => remove({ data: { id } }),
    onSuccess: (res) => {
      toast.success(res.message);
      setConfirmDelete(null);
      invalidate();
    },
    onError,
  });

  const addStockMutation = useMutation({
    mutationFn: (vars: { productId: string; payloads: string }) => addStockFn({ data: vars }),
    onSuccess: (res) => {
      toast.success(`Added ${res.added} stock item(s).`);
      setStockText("");
      invalidate();
    },
    onError,
  });

  const removeStockMutation = useMutation({
    mutationFn: (id: string) => removeStockItem({ data: { id } }),
    onSuccess: () => {
      toast.success("Stock item removed.");
      invalidate();
    },
    onError,
  });

  const clearStockMutation = useMutation({
    mutationFn: (productId: string) => clearStock({ data: { productId } }),
    onSuccess: (res) => {
      toast.success(`Removed ${res.removed} unsold item(s).`);
      invalidate();
    },
    onError,
  });

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  if (adminQuery.isLoading) {
    return <main className="p-10 text-muted-foreground">Loading…</main>;
  }

  if (!adminQuery.data?.isAdmin) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <Card className="max-w-sm text-center">
          <CardHeader>
            <CardTitle>Not authorized</CardTitle>
            <CardDescription>This account does not have administrator access to the shop.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={signOut}>
              Sign out
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  const products = productsQuery.data ?? [];

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-4 py-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Shop management</h1>
          <p className="text-sm text-muted-foreground">Everything here is live in your Telegram shop.</p>
        </div>
        <Button variant="ghost" onClick={signOut}>
          Sign out
        </Button>
      </header>

      <StatsBar />

      <Tabs defaultValue="products">
        <TabsList className="mb-4">
          <TabsTrigger value="products">Products</TabsTrigger>
          <TabsTrigger value="stock">Stock</TabsTrigger>
          <TabsTrigger value="orders">Orders</TabsTrigger>
          <TabsTrigger value="customers">Customers</TabsTrigger>
          <TabsTrigger value="referrals">Referrals</TabsTrigger>
          <TabsTrigger value="payouts">Payouts</TabsTrigger>
          <TabsTrigger value="bot">Bot</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="stock">
          <StockPanel />
        </TabsContent>
        <TabsContent value="orders">
          <OrdersPanel />
        </TabsContent>
        <TabsContent value="customers">
          <CustomersPanel />
        </TabsContent>
        <TabsContent value="referrals">
          <ReferralsPanel />
        </TabsContent>
        <TabsContent value="payouts">
          <WithdrawalsPanel />
        </TabsContent>
        <TabsContent value="bot">
          <BotPanel />
        </TabsContent>
        <TabsContent value="settings">
          <SettingsPanel />
        </TabsContent>

        <TabsContent value="products">
      <div className="mb-4">
        <Button onClick={() => setDraft({ ...emptyDraft })}>Add product</Button>
      </div>

      {productsQuery.isLoading && <p className="text-muted-foreground">Loading products…</p>}
      {!productsQuery.isLoading && products.length === 0 && (
        <Card>
          <CardHeader>
            <CardTitle>No products yet</CardTitle>
            <CardDescription>Add your first product, then add stock so customers can see it.</CardDescription>
          </CardHeader>
        </Card>
      )}

      <div className="grid gap-4">
        {products.map((p) => (
          <Card key={p.id}>
            <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <span>{p.emoji ?? "📦"}</span>
                  {p.name}
                  <Badge variant={p.active ? "default" : "secondary"}>{p.active ? "Visible" : "Hidden"}</Badge>
                </CardTitle>
                <CardDescription>
                  {p.slug} · {p.price.toFixed(2)} · {p.stock.available} available, {p.stock.reserved} reserved,{" "}
                  {p.stock.delivered} delivered
                </CardDescription>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setDraft({
                      id: p.id,
                      slug: p.slug,
                      name: p.name,
                      emoji: p.emoji ?? "",
                      description: p.description ?? "",
                      price: String(p.price),
                      salePrice: p.sale_price === null ? "" : String(p.sale_price),
                      saleEndsAt: p.sale_ends_at ? p.sale_ends_at.slice(0, 16) : "",
                      category: p.category,
                      deliveryNote: p.delivery_note ?? "",
                      sortOrder: String(p.sort_order),
                      active: p.active,
                    })
                  }
                >
                  Edit
                </Button>
                <Button variant="outline" size="sm" onClick={() => { setStockFor(p); setStockText(""); }}>
                  Stock
                </Button>
                <Button variant="destructive" size="sm" onClick={() => setConfirmDelete(p)}>
                  Delete
                </Button>
              </div>
            </CardHeader>
            {p.description && (
              <CardContent className="pt-0 text-sm text-muted-foreground">{p.description}</CardContent>
            )}
          </Card>
        ))}
      </div>

        </TabsContent>
      </Tabs>

      {/* Product editor */}
      <Dialog open={!!draft} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{draft?.id ? "Edit product" : "Add product"}</DialogTitle>
            <DialogDescription>Customers only see products marked visible that have stock.</DialogDescription>
          </DialogHeader>
          {draft && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="name">Name</Label>
                  <Input id="name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="slug">Short code</Label>
                  <Input id="slug" value={draft.slug} onChange={(e) => setDraft({ ...draft, slug: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="price">Price</Label>
                  <Input
                    id="price"
                    inputMode="decimal"
                    value={draft.price}
                    onChange={(e) => setDraft({ ...draft, price: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="emoji">Emoji</Label>
                  <Input id="emoji" value={draft.emoji} onChange={(e) => setDraft({ ...draft, emoji: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="sale">Sale price (optional)</Label>
                  <Input
                    id="sale"
                    inputMode="decimal"
                    value={draft.salePrice}
                    onChange={(e) => setDraft({ ...draft, salePrice: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="saleends">Sale ends (optional)</Label>
                  <Input
                    id="saleends"
                    type="datetime-local"
                    value={draft.saleEndsAt}
                    onChange={(e) => setDraft({ ...draft, saleEndsAt: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="category">Category</Label>
                  <Input
                    id="category"
                    value={draft.category}
                    onChange={(e) => setDraft({ ...draft, category: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="sort">Sort order</Label>
                  <Input
                    id="sort"
                    inputMode="numeric"
                    value={draft.sortOrder}
                    onChange={(e) => setDraft({ ...draft, sortOrder: e.target.value })}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="desc">Description</Label>
                <Textarea
                  id="desc"
                  rows={3}
                  value={draft.description}
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="delivery">Delivery instructions (shown on the product card)</Label>
                <Textarea
                  id="delivery"
                  rows={2}
                  value={draft.deliveryNote}
                  onChange={(e) => setDraft({ ...draft, deliveryNote: e.target.value })}
                />
              </div>
              <div className="flex items-center gap-3">
                <Switch
                  id="active"
                  checked={draft.active}
                  onCheckedChange={(v) => setDraft({ ...draft, active: v })}
                />
                <Label htmlFor="active">Visible to customers</Label>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button
              disabled={saveMutation.isPending}
              onClick={() => {
                if (!draft) return;
                if (!draft.name.trim()) {
                  toast.error("Enter a product name.");
                  return;
                }
                if (!/^[a-z0-9][a-z0-9_-]{1,31}$/.test(draft.slug.trim().toLowerCase())) {
                  toast.error("Short code: 2–32 characters, lowercase letters, numbers, - or _.");
                  return;
                }
                const price = Number(draft.price);
                if (!Number.isFinite(price) || price <= 0) {
                  toast.error("Enter a price greater than zero.");
                  return;
                }
                if (draft.salePrice.trim()) {
                  const sale = Number(draft.salePrice);
                  if (!Number.isFinite(sale) || sale <= 0 || sale >= price) {
                    toast.error("Sale price must be greater than zero and lower than the price.");
                    return;
                  }
                }
                saveMutation.mutate(draft);
              }}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Stock manager */}
      <Dialog open={!!stockFor} onOpenChange={(o) => !o && setStockFor(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Stock — {stockFor?.name}</DialogTitle>
            <DialogDescription>One item per line. Each line becomes one sellable item.</DialogDescription>
          </DialogHeader>
          <Textarea rows={5} value={stockText} onChange={(e) => setStockText(e.target.value)} placeholder="CODE-1&#10;CODE-2" />
          <div className="flex gap-2">
            <Button
              disabled={addStockMutation.isPending}
              onClick={() => {
                if (!stockFor) return;
                if (!stockText.trim()) {
                  toast.error("Enter at least one item.");
                  return;
                }
                addStockMutation.mutate({ productId: stockFor.id, payloads: stockText });
              }}
            >
              Add items
            </Button>
            <Button
              variant="outline"
              disabled={clearStockMutation.isPending}
              onClick={() => stockFor && clearStockMutation.mutate(stockFor.id)}
            >
              Remove all unsold
            </Button>
          </div>
          <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border p-2">
            {stockQuery.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
            {(stockQuery.data ?? []).map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-2 rounded px-2 py-1 text-sm">
                <span className="truncate font-mono">{s.payload}</span>
                <span className="flex items-center gap-2">
                  <Badge variant={s.status === "available" ? "secondary" : "outline"}>{s.status}</Badge>
                  {s.status === "available" && (
                    <Button size="sm" variant="ghost" onClick={() => removeStockMutation.mutate(s.id)}>
                      Remove
                    </Button>
                  )}
                </span>
              </div>
            ))}
            {!stockQuery.isLoading && (stockQuery.data ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground">No stock yet.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {confirmDelete?.name}?</DialogTitle>
            <DialogDescription>
              Unsold stock is removed too. If this product has sold or reserved items it is hidden instead of deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => confirmDelete && deleteMutation.mutate(confirmDelete.id)}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
