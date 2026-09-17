import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listStockOverview } from "@/lib/management.functions";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function StockPanel() {
  const fetchStock = useServerFn(listStockOverview);
  const query = useQuery({ queryKey: ["admin-stock-overview"], queryFn: () => fetchStock() });
  const rows = query.data ?? [];

  const low = rows.filter((r) => r.active && r.available === 0).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Stock levels</CardTitle>
        <CardDescription>
          Counts only — codes are never shown here.
          {low > 0 ? ` ${low} active product(s) are sold out.` : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {query.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
        {!query.isLoading && rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No products yet.</p>
        ) : null}
        {rows.map((r) => (
          <div
            key={r.product_id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
          >
            <div>
              <p className="font-medium">
                {r.emoji ? `${r.emoji} ` : ""}
                {r.name}
                {!r.active ? (
                  <Badge variant="outline" className="ml-2">
                    hidden
                  </Badge>
                ) : null}
                {r.active && r.available === 0 ? (
                  <Badge variant="destructive" className="ml-2">
                    sold out
                  </Badge>
                ) : null}
              </p>
              <p className="text-xs text-muted-foreground">
                {r.slug} · {r.price.toFixed(2)}
              </p>
            </div>
            <div className="flex gap-2 text-xs">
              <Badge variant="default">available {r.available}</Badge>
              <Badge variant="secondary">reserved {r.reserved}</Badge>
              <Badge variant="outline">delivered {r.delivered}</Badge>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
