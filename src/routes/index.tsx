import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Telegram Shop — Admin" },
      { name: "description", content: "Manage the products and stock of your Telegram storefront bot." },
      { property: "og:title", content: "Telegram Shop — Admin" },
      { property: "og:description", content: "Manage the products and stock of your Telegram storefront bot." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-muted/30 px-4 text-center">
      <div className="space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight">Telegram Shop</h1>
        <p className="max-w-md text-muted-foreground">
          Your storefront lives in Telegram. Products and stock are managed here.
        </p>
      </div>
      <Button asChild size="lg">
        <Link to="/admin">Open admin dashboard</Link>
      </Button>
    </main>
  );
}
