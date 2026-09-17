import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  listCustomers,
  listWalletTransactions,
  updateCustomer,
  type CustomerRow,
} from "@/lib/management.functions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function CustomersPanel() {
  const qc = useQueryClient();
  const fetchCustomers = useServerFn(listCustomers);
  const fetchLedger = useServerFn(listWalletTransactions);
  const change = useServerFn(updateCustomer);

  const [search, setSearch] = useState("");
  const [walletFor, setWalletFor] = useState<CustomerRow | null>(null);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");

  const customersQuery = useQuery({ queryKey: ["admin-customers"], queryFn: () => fetchCustomers() });
  const ledgerQuery = useQuery({
    queryKey: ["admin-ledger", walletFor?.id],
    queryFn: () => fetchLedger({ data: { botUserId: walletFor!.id } }),
    enabled: !!walletFor,
  });

  const mutation = useMutation({
    mutationFn: (vars: {
      id: string;
      role?: "admin" | "customer";
      isBlocked?: boolean;
      balanceDelta?: number;
      reason?: string;
    }) => change({ data: vars }),
    onSuccess: (res) => {
      toast.success(res.message);
      qc.invalidateQueries({ queryKey: ["admin-customers"] });
      qc.invalidateQueries({ queryKey: ["admin-ledger"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Something went wrong."),
  });

  const rows = (customersQuery.data ?? []).filter((c) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      String(c.telegram_id).includes(q) ||
      (c.username ?? "").toLowerCase().includes(q) ||
      (c.first_name ?? "").toLowerCase().includes(q)
    );
  });

  function applyBalance() {
    const value = Number(amount);
    if (!Number.isFinite(value) || value === 0) {
      toast.error("Enter an amount, for example 10 to add or -10 to remove.");
      return;
    }
    const trimmed = reason.trim();
    mutation.mutate({
      id: walletFor!.id,
      balanceDelta: value,
      ...(trimmed ? { reason: trimmed } : {}),
    });
    setAmount("");
    setReason("");
  }

  return (
    <div>
      <Input
        className="mb-4 max-w-sm"
        placeholder="Search by name, username or id"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {customersQuery.isLoading && <p className="text-muted-foreground">Loading customers…</p>}
      {!customersQuery.isLoading && rows.length === 0 && (
        <Card>
          <CardHeader>
            <CardTitle>No customers yet</CardTitle>
            <CardDescription>People appear here the first time they message your bot.</CardDescription>
          </CardHeader>
        </Card>
      )}

      <div className="grid gap-3">
        {rows.map((c) => (
          <Card key={c.id}>
            <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  {c.username ? `@${c.username}` : c.first_name || `Telegram user ${c.telegram_id}`}
                  {c.role === "admin" && <Badge>admin</Badge>}
                  {c.is_blocked && <Badge variant="destructive">blocked</Badge>}
                </CardTitle>
                <CardDescription>
                  Balance {c.balance.toFixed(2)} · {c.orders} order(s) · {c.spent.toFixed(2)} spent
                </CardDescription>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => setWalletFor(c)}>
                  Balance
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => mutation.mutate({ id: c.id, role: c.role === "admin" ? "customer" : "admin" })}
                >
                  {c.role === "admin" ? "Remove admin" : "Make admin"}
                </Button>
                <Button
                  size="sm"
                  variant={c.is_blocked ? "outline" : "destructive"}
                  onClick={() => mutation.mutate({ id: c.id, isBlocked: !c.is_blocked })}
                >
                  {c.is_blocked ? "Unblock" : "Block"}
                </Button>
              </div>
            </CardHeader>
          </Card>
        ))}
      </div>

      <Dialog open={!!walletFor} onOpenChange={(o) => !o && setWalletFor(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Balance</DialogTitle>
            <DialogDescription>
              Add or remove money from this customer. Every change is recorded with a reason.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="amount">Amount (use a minus sign to remove)</Label>
              <Input id="amount" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="10" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="reason">Reason</Label>
              <Input id="reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Top-up received" />
            </div>
            <div className="max-h-56 overflow-y-auto rounded-md border p-3 text-sm">
              {(ledgerQuery.data ?? []).length === 0 && <p className="text-muted-foreground">No history yet.</p>}
              {(ledgerQuery.data ?? []).map((t) => (
                <p key={t.id} className="border-b py-1 last:border-0">
                  {t.amount > 0 ? "+" : ""}
                  {t.amount.toFixed(2)} → {t.balance_after.toFixed(2)} · {t.reason} ·{" "}
                  {new Date(t.created_at).toLocaleString()}
                </p>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setWalletFor(null)}>
              Close
            </Button>
            <Button onClick={applyBalance} disabled={mutation.isPending}>
              Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
