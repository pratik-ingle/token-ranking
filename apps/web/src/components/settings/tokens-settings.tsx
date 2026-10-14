"use client";

import { KeyRound, Loader2, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { callApi, ClientApiError } from "@/lib/client-api";
import { timeAgo } from "@/lib/utils";
import { CodeLine } from "../copy-button";
import { Alert } from "../ui/alert";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

export interface TokenRow {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  created_at: string;
  last_used_at: string | null;
}

export function TokensSettings({ rows }: { rows: TokenRow[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [created, setCreated] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      {rows.length > 0 && (
        <ul className="divide-y rounded-lg border">
          {rows.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
              <KeyRound className="size-4 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="font-medium">{t.name}</div>
                <div className="text-xs text-muted-foreground">
                  <code>{t.prefix}…</code> · {t.scopes.join(", ")} · created {timeAgo(t.created_at)} · last used {timeAgo(t.last_used_at)}
                </div>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  if (!confirm(`Revoke "${t.name}"? Anything using it stops working immediately.`)) return;
                  await callApi(`/api/me/tokens/${t.id}`, { method: "DELETE" });
                  router.refresh();
                }}
              >
                <Trash2 /> Revoke
              </Button>
            </li>
          ))}
        </ul>
      )}
      {created && (
        <Alert variant="success" className="space-y-2">
          <p className="font-medium">Copy your token now. It won&apos;t be shown again.</p>
          <CodeLine code={created} />
        </Alert>
      )}
      {error && <Alert variant="destructive">{error}</Alert>}
      <form
        className="flex flex-wrap gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            const r = await callApi<{ token: string }>("/api/me/tokens", { body: { name } });
            setCreated(r.token);
            setName("");
            router.refresh();
          } catch (err) {
            setError(err instanceof ClientApiError ? err.message : "Could not create token.");
          } finally {
            setBusy(false);
          }
        }}
      >
        <Input placeholder="Token name, e.g. litellm-proxy" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} className="max-w-xs" required />
        <Button type="submit" variant="outline" disabled={busy}>{busy && <Loader2 className="animate-spin" />} Create token</Button>
      </form>
    </div>
  );
}
