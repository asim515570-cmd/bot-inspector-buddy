import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { broadcast, getSettings, saveSettings } from "@/lib/management.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function SettingsPanel() {
  const fetchSettings = useServerFn(getSettings);
  const save = useServerFn(saveSettings);
  const send = useServerFn(broadcast);

  const settingsQuery = useQuery({ queryKey: ["admin-settings"], queryFn: () => fetchSettings() });
  const [welcome, setWelcome] = useState("");
  const [support, setSupport] = useState("");
  const [payment, setPayment] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!settingsQuery.data) return;
    setWelcome(settingsQuery.data["welcome_message"] ?? "");
    setSupport(settingsQuery.data["support_contact"] ?? "");
    setPayment(settingsQuery.data["payment_instructions"] ?? "");
  }, [settingsQuery.data]);

  const onError = (e: unknown) => toast.error(e instanceof Error ? e.message : "Something went wrong.");

  const saveMutation = useMutation({
    mutationFn: () =>
      save({
        data: {
          welcome_message: welcome,
          support_contact: support,
          payment_instructions: payment,
        },
      }),
    onSuccess: (res) => toast.success(res.message),
    onError,
  });

  const broadcastMutation = useMutation({
    mutationFn: () => send({ data: { text: message } }),
    onSuccess: (res) => {
      toast.success(`Sent to ${res.sent} of ${res.total} people.`);
      setMessage("");
    },
    onError,
  });

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Shop messages</CardTitle>
          <CardDescription>What your customers read inside Telegram.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="welcome">Welcome message</Label>
            <Textarea id="welcome" rows={2} value={welcome} onChange={(e) => setWelcome(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="payment">Payment instructions</Label>
            <Textarea id="payment" rows={3} value={payment} onChange={(e) => setPayment(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="support">Support contact</Label>
            <Input id="support" value={support} onChange={(e) => setSupport(e.target.value)} placeholder="@yourname" />
          </div>
          <div>
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
              Save
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Announcement</CardTitle>
          <CardDescription>Send one message to everyone who uses your bot (blocked people are skipped).</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <Textarea rows={3} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="New stock just landed!" />
          <div>
            <Button
              onClick={() => broadcastMutation.mutate()}
              disabled={broadcastMutation.isPending || message.trim().length === 0}
            >
              {broadcastMutation.isPending ? "Sending…" : "Send to everyone"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
