import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getDashboardStats } from "@/lib/management.functions";
import { Card, CardContent } from "@/components/ui/card";

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-semibold">{value}</p>
      </CardContent>
    </Card>
  );
}

export function StatsBar() {
  const fetchStats = useServerFn(getDashboardStats);
  const { data } = useQuery({ queryKey: ["admin-stats"], queryFn: () => fetchStats() });
  if (!data) return null;

  return (
    <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      <Stat label="Products" value={`${data.activeProducts}/${data.products}`} />
      <Stat label="In stock" value={data.availableStock} />
      <Stat label="Customers" value={data.customers} />
      <Stat label="Pending" value={data.pendingOrders} />
      <Stat label="Delivered" value={data.deliveredOrders} />
      <Stat label="Revenue" value={data.revenue.toFixed(2)} />
    </div>
  );
}
