import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listReferrals, type ReferrerRow } from "@/lib/management.functions";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

function label(r: ReferrerRow) {
  return r.username ? `@${r.username}` : r.first_name || `id ${r.telegram_id}`;
}

export function ReferralsPanel() {
  const fetchReferrals = useServerFn(listReferrals);
  const query = useQuery({ queryKey: ["admin-referrals"], queryFn: () => fetchReferrals() });
  const rows = query.data ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Referrals</CardTitle>
        <CardDescription>Who invited customers and how much commission they earned.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {query.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
        {!query.isLoading && rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No referral activity yet.</p>
        ) : null}
        {rows.map((r) => (
          <div
            key={r.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
          >
            <div>
              <p className="font-medium">{label(r)}</p>
              <p className="text-xs text-muted-foreground">code {r.referral_code ?? "—"}</p>
            </div>
            <div className="flex gap-2 text-xs">
              <Badge variant="secondary">invited {r.invited}</Badge>
              <Badge variant="default">earned {r.referral_earned.toFixed(2)}</Badge>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
