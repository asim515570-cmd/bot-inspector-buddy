import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  decideWithdrawal,
  listWithdrawals,
  type WithdrawalRow,
} from "@/lib/management.functions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const FILTERS = ["pending", "approved", "rejected", "all"] as const;
type Filter = (typeof FILTERS)[number];

const tone: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "secondary",
  approved: "default",
  rejected: "destructive",
};

function customerLabel(w: WithdrawalRow) {
  if (!w.customer) return "unknown customer";
  return w.customer.username
    ? `@${w.customer.username}`
    : w.customer.first_name || `id ${w.customer.telegram_id}`;
}

export function WithdrawalsPanel() {
  const qc = useQueryClient();
  const fetchPayouts = useServerFn(listWithdrawals);
  const decide = useServerFn(decideWithdrawal);
  const [filter, setFilter] = useState<Filter>("pending");

  const query = useQuery({
    queryKey: ["admin-withdrawals", filter],
    queryFn: () => fetchPayouts({ data: { status: filter } }),
  });

  const mutation = useMutation({
    mutationFn: (vars: { id: string; approve: boolean }) => decide({ data: vars }),
    onSuccess: (res) => {
      toast.success(res.message);
      qc.invalidateQueries({ queryKey: ["admin-withdrawals"] });
      qc.invalidateQueries({ queryKey: ["admin-stats"] });
      qc.invalidateQueries({ queryKey: ["admin-customers"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Something went wrong."),
  });

  const rows = query.data ?? [];

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Button
            key={f}
            size="sm"
            variant={filter === f ? "default" : "outline"}
            onClick={() => setFilter(f)}
          >
            {f}
          </Button>
        ))}
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">No payout requests here</CardTitle>
            <CardDescription>
              Customers request payouts from the bot with /withdraw. The amount is held until you
              decide.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="space-y-3">
          {rows.map((w) => (
            <Card key={w.id}>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{w.amount.toFixed(2)}</span>
                    <Badge variant={tone[w.status] ?? "outline"}>{w.status}</Badge>
                    <span className="text-sm text-muted-foreground">{w.method}</span>
                  </div>
                  <p className="mt-1 truncate text-sm text-muted-foreground">
                    {customerLabel(w)} · {w.address}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(w.created_at).toLocaleString()}
                    {w.admin_note ? ` · ${w.admin_note}` : ""}
                  </p>
                </div>
                {w.status === "pending" && (
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      disabled={mutation.isPending}
                      onClick={() => {
                        mutation.mutate({ id: w.id, approve: true });
                      }}
                    >
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={mutation.isPending}
                      onClick={() => {
                        mutation.mutate({ id: w.id, approve: false });
                      }}
                    >
                      Reject
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
