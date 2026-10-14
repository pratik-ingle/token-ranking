"use client";

import { Check, Loader2, ShieldAlert, X } from "lucide-react";
import { useState } from "react";
import { callApi, ClientApiError } from "@/lib/client-api";
import { Alert } from "./ui/alert";
import { Button } from "./ui/button";
import { Input, Label } from "./ui/input";

export function DeviceApprove({ initialCode, username }: { initialCode: string; username: string }) {
  const [code, setCode] = useState(initialCode);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<"approved" | "denied" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(approve: boolean) {
    setBusy(true);
    setError(null);
    try {
      await callApi("/api/device/approve", { body: { user_code: code, approve } });
      setResult(approve ? "approved" : "denied");
    } catch (e) {
      setError(e instanceof ClientApiError ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  if (result === "approved") {
    return (
      <Alert variant="success">
        <Check /> Approved. Return to your terminal; the collector is now signed in as <strong>{username}</strong>.
      </Alert>
    );
  }
  if (result === "denied") return <Alert>Denied. The terminal will show an error; nothing was connected.</Alert>;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="code">Code shown in your terminal</Label>
        <Input id="code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="ABCD-EFGH" className="font-mono text-lg tracking-widest" autoComplete="off" />
      </div>
      <Alert variant="warning">
        <ShieldAlert /> Only approve if you just ran <code>tokenrank-collector login</code> or set up the MCP server yourself.
        The device will be able to upload usage and read your rank as <strong>{username}</strong>.
      </Alert>
      {error && <Alert variant="destructive">{error}</Alert>}
      <div className="flex gap-3">
        <Button className="flex-1" disabled={busy || code.length < 8} onClick={() => decide(true)}>
          {busy ? <Loader2 className="animate-spin" /> : <Check />} Approve
        </Button>
        <Button variant="outline" disabled={busy || code.length < 8} onClick={() => decide(false)}>
          <X /> Deny
        </Button>
      </div>
    </div>
  );
}
