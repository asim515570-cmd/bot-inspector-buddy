import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Package,
  Layers,
  Users,
  Clock,
  CheckCircle2,
  Banknote,
  TrendingUp,
} from "lucide-react";
import { getDashboardStats } from "@/lib/management.functions";
import { Card, CardContent } from "@/components/ui/card";

function Stat({
  label,
  value,
  icon: Icon,
  accent,
}: {
  label: string;
  value: string | number;
  icon: typeof Package;
  accent?: boolean;
}) {
  return (
    <Card className="border-border/70 bg-card/80 shadow-none">
      <CardContent className="flex items-center gap-3 p-4">
        <span
          className={
            accent
              ? "flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary"
              : "flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-muted-foreground"
          }
        >
          <Icon className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
            {label}
          </p>
          <p className="font-display text-xl font-semibold leading-tight">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

export function StatsBar() {
  const fetchStats = useServerFn(getDashboardStats);
  const { data } = useQuery({ queryKey: ["admin-stats"], queryFn: () => fetchStats() });
  if (!data) return null;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-7">
      <Stat label="Products" value={`${data.activeProducts}/${data.products}`} icon={Package} />
      <Stat label="In stock" value={data.availableStock} icon={Layers} />
      <Stat label="Customers" value={data.customers} icon={Users} />
      <Stat label="Pending" value={data.pendingOrders} icon={Clock} />
      <Stat label="Delivered" value={data.deliveredOrders} icon={CheckCircle2} />
      <Stat label="Payouts" value={data.pendingWithdrawals} icon={Banknote} />
      <Stat label="Revenue" value={data.revenue.toFixed(2)} icon={TrendingUp} accent />
    </div>
  );
}
