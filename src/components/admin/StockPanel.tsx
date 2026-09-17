import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { listStockOverview } from "@/lib/management.functions";
import { addStock } from "@/lib/admin.functions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

export function StockPanel() {
  const qc = useQueryClient();
  const fetchStock = useServerFn(listStockOverview);
  const addStockFn = useServerFn(addStock);
  const query = useQuery({ queryKey: ["admin-stock-overview"], queryFn: () => fetchStock() });
  const rows = query.data ?? [];

  const [target, setTarget] = useState<{ id: string; name: string } | null>(null);
  const [codes, setCodes] = useState("");

  const addMutation = useMutation({
    mutationFn: () => addStockFn({ data: { productId: target!.id, payloads: codes } }),
    onSuccess: (res) => {
      toast.success(`Added ${res.added} code(s).`);
      setCodes("");
      setTarget(null);
      qc.invalidateQueries({ queryKey: ["admin-stock-overview"] });
      qc.invalidateQueries({ queryKey: ["admin-products"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const low = rows.filter((r) => r.active && r.available === 0).length;

  return (
    <>
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
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <Badge variant="default">available {r.available}</Badge>
                <Badge variant="secondary">reserved {r.reserved}</Badge>
                <Badge variant="outline">delivered {r.delivered}</Badge>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setCodes("");
                    setTarget({ id: r.product_id, name: r.name });
                  }}
                >
                  Add codes
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Dialog open={!!target} onOpenChange={(o) => !o && setTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add codes — {target?.name}</DialogTitle>
            <DialogDescription>
              One code or account per line. They are delivered to buyers in order.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            rows={8}
            value={codes}
            onChange={(e) => setCodes(e.target.value)}
            placeholder={"user1@mail.com:pass123\nCODE-ABCD-1234"}
          />
          <DialogFooter>
            <Button
              disabled={addMutation.isPending || codes.trim().length === 0}
              onClick={() => addMutation.mutate()}
            >
              {addMutation.isPending ? "Adding…" : "Add to stock"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
