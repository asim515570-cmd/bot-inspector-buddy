import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { getAnalytics, listActivity } from "@/lib/management.functions";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

export function OverviewPanel() {
  const fetchAnalytics = useServerFn(getAnalytics);
  const fetchActivity = useServerFn(listActivity);
  const analytics = useQuery({ queryKey: ["admin-analytics"], queryFn: () => fetchAnalytics() });
  const activity = useQuery({ queryKey: ["admin-activity"], queryFn: () => fetchActivity() });
  const a = analytics.data;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Revenue (7 days)", value: money(a?.revenue7d ?? 0) },
          { label: "Revenue (30 days)", value: money(a?.revenue30d ?? 0) },
          { label: "Average order", value: money(a?.averageOrder ?? 0) },
          { label: "New customers (7 days)", value: String(a?.newCustomers7d ?? 0) },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className="font-display text-2xl font-semibold">{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Sales — last 14 days</CardTitle>
          <CardDescription>Paid and delivered orders only.</CardDescription>
        </CardHeader>
        <CardContent className="h-64">
          {analytics.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={a?.days ?? []} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
                <defs>
                  <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                <XAxis
                  dataKey="date"
                  tickFormatter={(d: string) => d.slice(5)}
                  stroke="var(--color-muted-foreground)"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  stroke="var(--color-muted-foreground)"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  width={44}
                />
                <Tooltip
                  contentStyle={{
                    background: "var(--color-card)",
                    border: "1px solid var(--color-border)",
                    borderRadius: 8,
                    color: "var(--color-foreground)",
                    fontSize: 12,
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="revenue"
                  stroke="var(--color-primary)"
                  fill="url(#rev)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Best sellers</CardTitle>
            <CardDescription>By revenue over the last 30 days.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {(a?.topProducts ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No sales yet.</p>
            ) : null}
            {(a?.topProducts ?? []).map((p) => (
              <div key={p.name} className="flex items-center justify-between rounded-md border p-3">
                <span className="text-sm">
                  {p.emoji ? `${p.emoji} ` : ""}
                  {p.name}
                </span>
                <span className="text-xs text-muted-foreground">
                  {p.units} sold · {money(p.revenue)}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent admin activity</CardTitle>
            <CardDescription>Every dashboard action is recorded.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {(activity.data ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing yet.</p>
            ) : null}
            {(activity.data ?? []).slice(0, 12).map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-3 rounded-md border p-3">
                <div className="min-w-0">
                  <Badge variant="outline">{r.action}</Badge>
                  <p className="truncate text-xs text-muted-foreground">{r.actor}</p>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {new Date(r.created_at).toLocaleString()}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
