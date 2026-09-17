import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { getBotStatus, syncBotCommands } from "@/lib/management.functions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function BotPanel() {
  const qc = useQueryClient();
  const fetchStatus = useServerFn(getBotStatus);
  const sync = useServerFn(syncBotCommands);

  const query = useQuery({ queryKey: ["admin-bot-status"], queryFn: () => fetchStatus() });
  const syncMutation = useMutation({
    mutationFn: () => sync(),
    onSuccess: (res) => {
      toast.success(res.message);
      qc.invalidateQueries({ queryKey: ["admin-bot-status"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Something went wrong."),
  });

  const s = query.data;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Bot connection</CardTitle>
        <CardDescription>Live status of the Telegram bot and its menu.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {query.isLoading ? <p className="text-sm text-muted-foreground">Checking…</p> : null}
        {s ? (
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <Badge variant={s.connected ? "default" : "destructive"}>
                {s.connected ? "connected" : "not connected"}
              </Badge>
              {s.username ? <span>@{s.username}</span> : null}
            </div>
            <p className="text-muted-foreground">
              Message address: {s.webhookUrl ? s.webhookUrl : "not set — publish the app, then register it"}
            </p>
            <p className="text-muted-foreground">Waiting messages: {s.pendingUpdates}</p>
            {s.lastError ? <p className="text-destructive">Last error: {s.lastError}</p> : null}
          </div>
        ) : null}
        <div className="flex gap-2">
          <Button
            variant="secondary"
            onClick={() => query.refetch()}
            disabled={query.isFetching}
          >
            Refresh
          </Button>
          <Button onClick={() => syncMutation.mutate()} disabled={syncMutation.isPending}>
            {syncMutation.isPending ? "Updating…" : "Update bot menu"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
