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
  const [methods, setMethods] = useState("");
  const [percent, setPercent] = useState("");
  const [minWithdraw, setMinWithdraw] = useState("");
  const [botUsername, setBotUsername] = useState("");
  const [storeName, setStoreName] = useState("");
  const [channelUrl, setChannelUrl] = useState("");
  const [groupUrl, setGroupUrl] = useState("");
  const [termsUrl, setTermsUrl] = useState("");
  const [notice, setNotice] = useState("");
  const [apiInfo, setApiInfo] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!settingsQuery.data) return;
    setWelcome(settingsQuery.data["welcome_message"] ?? "");
    setSupport(settingsQuery.data["support_contact"] ?? "");
    setPayment(settingsQuery.data["payment_instructions"] ?? "");
    setMethods(settingsQuery.data["payment_methods"] ?? "");
    setPercent(settingsQuery.data["referral_percent"] ?? "");
    setMinWithdraw(settingsQuery.data["min_withdraw"] ?? "");
    setBotUsername(settingsQuery.data["bot_username"] ?? "");
    setStoreName(settingsQuery.data["store_name"] ?? "");
    setChannelUrl(settingsQuery.data["channel_url"] ?? "");
    setGroupUrl(settingsQuery.data["group_url"] ?? "");
    setTermsUrl(settingsQuery.data["terms_url"] ?? "");
    setNotice(settingsQuery.data["notice"] ?? "");
    setApiInfo(settingsQuery.data["api_info"] ?? "");
  }, [settingsQuery.data]);

  const onError = (e: unknown) => toast.error(e instanceof Error ? e.message : "Something went wrong.");

  const saveMutation = useMutation({
    mutationFn: () =>
      save({
        data: {
          welcome_message: welcome,
          support_contact: support,
          payment_instructions: payment,
          payment_methods: methods,
          referral_percent: percent,
          min_withdraw: minWithdraw,
          bot_username: botUsername,
          store_name: storeName,
          channel_url: channelUrl,
          group_url: groupUrl,
          terms_url: termsUrl,
          notice: notice,
          api_info: apiInfo,
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
            <Label htmlFor="store">Store name</Label>
            <Input id="store" value={storeName} onChange={(e) => setStoreName(e.target.value)} placeholder="Dodi Store" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="welcome">Welcome message</Label>
            <Textarea id="welcome" rows={2} value={welcome} onChange={(e) => setWelcome(e.target.value)} />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="grid gap-1.5">
              <Label htmlFor="channel">Channel link</Label>
              <Input id="channel" value={channelUrl} onChange={(e) => setChannelUrl(e.target.value)} placeholder="https://t.me/yourchannel" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="group">Group link</Label>
              <Input id="group" value={groupUrl} onChange={(e) => setGroupUrl(e.target.value)} placeholder="https://t.me/yourgroup" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="terms">Terms link</Label>
              <Input id="terms" value={termsUrl} onChange={(e) => setTermsUrl(e.target.value)} placeholder="https://t.me/yourchannel/2" />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="notice">Notice on the welcome screen</Label>
            <Input id="notice" value={notice} onChange={(e) => setNotice(e.target.value)} placeholder="Support time is 9:00PM to 12:00AM" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="apiinfo">Developer API text</Label>
            <Textarea id="apiinfo" rows={2} value={apiInfo} onChange={(e) => setApiInfo(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="payment">Payment instructions</Label>
            <Textarea id="payment" rows={3} value={payment} onChange={(e) => setPayment(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="methods">Payment options</Label>
            <Textarea
              id="methods"
              rows={6}
              value={methods}
              onChange={(e) => setMethods(e.target.value)}
              placeholder={"Binance Pay | Send to ID 123456789\nUPI | Pay to shop@upi"}
            />
            <p className="text-xs text-muted-foreground">
              One option per line: name, then a vertical bar, then the payment details the customer sees.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="grid gap-1.5">
              <Label htmlFor="percent">Referral reward (%)</Label>
              <Input id="percent" value={percent} onChange={(e) => setPercent(e.target.value)} placeholder="5" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="minwd">Minimum payout</Label>
              <Input id="minwd" value={minWithdraw} onChange={(e) => setMinWithdraw(e.target.value)} placeholder="10" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="botuser">Bot username</Label>
              <Input id="botuser" value={botUsername} onChange={(e) => setBotUsername(e.target.value)} placeholder="myshopbot" />
            </div>
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
