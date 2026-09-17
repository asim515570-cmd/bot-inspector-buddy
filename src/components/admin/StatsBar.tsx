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
    <Card className="border-border bg-card shadow-sm">
      <CardContent className="flex min-h-24 items-center gap-3 p-4">
        <span
          className={
            accent
              ? "flex size-10 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground"
              : "flex size-10 shrink-0 items-center justify-center rounded-md bg-accent text-primary"
          }
        >
          <Icon className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">
            {label}
          </p>
          <p className="mt-1 font-display text-xl font-semibold leading-tight">{value}</p>
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
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-7">
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
