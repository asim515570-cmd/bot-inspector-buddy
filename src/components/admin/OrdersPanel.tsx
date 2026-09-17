import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { listOrders, updateOrder, type OrderRow } from "@/lib/management.functions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const FILTERS = ["all", "pending", "paid", "delivered", "cancelled", "refunded"] as const;
type Filter = (typeof FILTERS)[number];

const tone: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "secondary",
  paid: "default",
  delivered: "outline",
  cancelled: "destructive",
  refunded: "destructive",
};

function customerLabel(o: OrderRow) {
  if (!o.customer) return "unknown customer";
  return o.customer.username ? `@${o.customer.username}` : o.customer.first_name || `id ${o.customer.telegram_id}`;
}

export function OrdersPanel() {
  const qc = useQueryClient();
  const fetchOrders = useServerFn(listOrders);
  const change = useServerFn(updateOrder);
  const [filter, setFilter] = useState<Filter>("all");

  const ordersQuery = useQuery({
    queryKey: ["admin-orders", filter],
    queryFn: () => fetchOrders({ data: { status: filter } }),
  });

  const mutation = useMutation({
    mutationFn: (vars: { id: string; action: "mark_paid" | "deliver" | "cancel" | "refund" }) =>
      change({ data: vars }),
    onSuccess: (res) => {
      toast.success(res.message);
      qc.invalidateQueries({ queryKey: ["admin-orders"] });
      qc.invalidateQueries({ queryKey: ["admin-stats"] });
      qc.invalidateQueries({ queryKey: ["admin-products"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Something went wrong."),
  });

  const orders = ordersQuery.data ?? [];

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Button key={f} size="sm" variant={filter === f ? "default" : "outline"} onClick={() => setFilter(f)}>
            {f}
          </Button>
        ))}
      </div>

      {ordersQuery.isLoading && <p className="text-muted-foreground">Loading orders…</p>}
      {!ordersQuery.isLoading && orders.length === 0 && (
        <Card>
          <CardHeader>
            <CardTitle>No orders here</CardTitle>
            <CardDescription>Orders appear as soon as a customer taps Buy in Telegram.</CardDescription>
          </CardHeader>
        </Card>
      )}

      <div className="grid gap-3">
        {orders.map((o) => (
          <Card key={o.id}>
            <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 pb-3">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  <span>{o.product?.emoji ?? "📦"}</span>
                  {o.product?.name ?? "Deleted product"}
                  <Badge variant={tone[o.status] ?? "secondary"}>{o.status}</Badge>
                </CardTitle>
                <CardDescription>
                  {customerLabel(o)} · {o.total_price.toFixed(2)} · {new Date(o.created_at).toLocaleString()}
                  {o.payment_reference ? ` · ref ${o.payment_reference}` : ""}
                </CardDescription>
              </div>
              <div className="flex flex-wrap gap-2">
                {o.status === "pending" && (
                  <Button size="sm" onClick={() => mutation.mutate({ id: o.id, action: "mark_paid" })}>
                    Mark paid
                  </Button>
                )}
                {(o.status === "pending" || o.status === "paid") && (
                  <Button size="sm" variant="outline" onClick={() => mutation.mutate({ id: o.id, action: "deliver" })}>
                    Deliver
                  </Button>
                )}
                {(o.status === "pending" || o.status === "paid") && (
                  <Button size="sm" variant="outline" onClick={() => mutation.mutate({ id: o.id, action: "cancel" })}>
                    Cancel
                  </Button>
                )}
                {o.status !== "refunded" && o.status !== "cancelled" && (
                  <Button size="sm" variant="destructive" onClick={() => mutation.mutate({ id: o.id, action: "refund" })}>
                    Refund
                  </Button>
                )}
              </div>
            </CardHeader>
            {o.admin_note && <CardContent className="pt-0 text-sm text-muted-foreground">{o.admin_note}</CardContent>}
          </Card>
        ))}
      </div>
    </div>
  );
}
