import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { broadcast } from "@/lib/management.functions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";

export function BroadcastPanel() {
  const send = useServerFn(broadcast);
  const [text, setText] = useState("");

  const mutation = useMutation({
    mutationFn: () => send({ data: { text } }),
    onSuccess: (res) => {
      toast.success(`Sent to ${res.sent} of ${res.total} customers.`);
      setText("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Broadcast a message</CardTitle>
        <CardDescription>
          Goes to every customer who is not blocked. Blocked customers are skipped.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Textarea
          rows={7}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="New stock just landed! Open the shop to grab yours."
        />
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">{text.trim().length}/3000 characters</p>
          <Button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || text.trim().length === 0 || text.length > 3000}
          >
            {mutation.isPending ? "Sending…" : "Send to everyone"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
