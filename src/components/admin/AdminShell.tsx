import type { ReactNode } from "react";
import {
  Package,
  Layers,
  ReceiptText,
  Users,
  Share2,
  Banknote,
  Bot,
  Settings,
  LayoutDashboard,
  Megaphone,
  LogOut,
  Store,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export type AdminSection =
  | "overview"
  | "products"
  | "stock"
  | "orders"
  | "customers"
  | "referrals"
  | "payouts"
  | "bot"
  | "broadcast"
  | "settings";

const NAV: { id: AdminSection; label: string; icon: typeof Package; group: string }[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard, group: "Insights" },
  { id: "products", label: "Products", icon: Package, group: "Catalogue" },
  { id: "stock", label: "Stock", icon: Layers, group: "Catalogue" },
  { id: "orders", label: "Orders", icon: ReceiptText, group: "Sales" },
  { id: "customers", label: "Customers", icon: Users, group: "Sales" },
  { id: "referrals", label: "Referrals", icon: Share2, group: "Sales" },
  { id: "payouts", label: "Payouts", icon: Banknote, group: "Sales" },
  { id: "bot", label: "Bot", icon: Bot, group: "System" },
  { id: "broadcast", label: "Broadcast", icon: Megaphone, group: "System" },
  { id: "settings", label: "Settings", icon: Settings, group: "System" },
];

const GROUPS = ["Insights", "Catalogue", "Sales", "System"];

export function AdminShell({
  section,
  onSection,
  onSignOut,
  title,
  description,
  actions,
  children,
}: {
  section: AdminSection;
  onSection: (s: AdminSection) => void;
  onSignOut: () => void;
  title: string;
  description: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen w-full bg-background text-foreground">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar md:flex">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <span className="flex size-9 items-center justify-center rounded-xl bg-primary/15 text-primary">
            <Store className="size-5" />
          </span>
          <div className="leading-tight">
            <p className="font-display text-sm font-semibold text-sidebar-foreground">Shop Console</p>
            <p className="text-xs text-muted-foreground">Telegram storefront</p>
          </div>
        </div>

        <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-4">
          {GROUPS.map((group) => (
            <div key={group}>
              <p className="px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                {group}
              </p>
              <ul className="space-y-0.5">
                {NAV.filter((i) => i.group === group).map((item) => {
                  const active = item.id === section;
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => onSection(item.id)}
                        className={cn(
                          "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors",
                          active
                            ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                            : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                        )}
                      >
                        <item.icon className={cn("size-4", active && "text-primary")} />
                        {item.label}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="border-t border-sidebar-border p-3">
          <Button variant="ghost" className="w-full justify-start gap-2 text-muted-foreground" onClick={onSignOut}>
            <LogOut className="size-4" /> Sign out
          </Button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 border-b border-border bg-background/85 backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 lg:px-8">
            <div>
              <h1 className="font-display text-xl font-semibold">{title}</h1>
              <p className="text-sm text-muted-foreground">{description}</p>
            </div>
            <div className="flex items-center gap-2">{actions}</div>
          </div>
          <div className="flex gap-1 overflow-x-auto border-t border-border px-3 py-2 md:hidden">
            {NAV.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onSection(item.id)}
                className={cn(
                  "whitespace-nowrap rounded-lg px-3 py-1.5 text-sm",
                  item.id === section
                    ? "bg-accent font-medium text-accent-foreground"
                    : "text-muted-foreground",
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
        </header>

        <main className="flex-1 px-5 py-6 lg:px-8">
          <div className="mx-auto w-full max-w-6xl space-y-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
