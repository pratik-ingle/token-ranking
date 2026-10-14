"use client";

import { Download, Loader2, Trash2 } from "lucide-react";
import { useState } from "react";
import { callApi, ClientApiError } from "@/lib/client-api";
import { Alert } from "../ui/alert";
import { Button, buttonVariants } from "../ui/button";
import { Input } from "../ui/input";

export function DangerZone({ username }: { username: string }) {
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">Export my data</p>
          <p className="text-xs text-muted-foreground">Everything we store about you, as JSON.</p>
        </div>
        <a href="/api/me/export" className={buttonVariants({ variant: "outline" })}><Download /> Download JSON</a>
      </div>
      <div className="space-y-2 rounded-lg border border-destructive/40 p-4">
        <p className="text-sm font-medium text-destructive">Delete account</p>
        <p className="text-xs text-muted-foreground">
          Immediately and permanently deletes your account, usage history, integrations, encrypted keys, tokens and passkeys,
          and removes you from every leaderboard in the same request. This can&apos;t be undone.
        </p>
        <div className="flex flex-wrap gap-2">
          <Input placeholder={`Type ${username} to confirm`} value={confirmText} onChange={(e) => setConfirmText(e.target.value)} className="max-w-xs" />
          <Button
            variant="destructive"
            disabled={confirmText !== username || busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await callApi(`/api/me?confirm=${encodeURIComponent(username)}`, { method: "DELETE" });
                window.location.href = "/?deleted=1";
              } catch (e) {
                setError(e instanceof ClientApiError ? e.message : "Could not delete account.");
                setBusy(false);
              }
            }}
          >
            {busy ? <Loader2 className="animate-spin" /> : <Trash2 />} Delete everything
          </Button>
        </div>
        {error && <Alert variant="destructive">{error}</Alert>}
      </div>
    </div>
  );
}
