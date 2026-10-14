"use client";

import { SOURCE_LABELS, type Source } from "@tokenrank/shared";
import { AlertTriangle, CloudUpload, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { callApi, ClientApiError } from "@/lib/client-api";
import { timeAgo } from "@/lib/utils";
import { Alert } from "../ui/alert";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input, Label, Select } from "../ui/input";

export interface IntegrationRow {
  id: string;
  source: Source;
  mode: "local" | "cloud" | "upload";
  status: string;
  status_detail: string | null;
  last_synced_at: string | null;
  has_credential: boolean;
}

const MODE_LABEL = { local: "Collector / API", cloud: "Cloud sync", upload: "CSV upload" } as const;

export function IntegrationsSettings({ rows }: { rows: IntegrationRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(id: string, fn: () => Promise<unknown>) {
    setBusy(id);
    setError(null);
    try {
      await fn();
      router.refresh();
    } catch (e) {
      setError(e instanceof ClientApiError ? e.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing connected yet.</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  {SOURCE_LABELS[r.source]}
                  <Badge variant="outline">{MODE_LABEL[r.mode]}</Badge>
                  {r.status === "active" && <Badge>active</Badge>}
                  {r.status === "error" && <Badge variant="destructive">error</Badge>}
                  {r.status === "duplicate" && <Badge variant="warning">counted once</Badge>}
                </div>
                <p className="text-xs text-muted-foreground">
                  Last sync {timeAgo(r.last_synced_at)}
                  {r.status_detail ? ` · ${r.status_detail}` : ""}
                </p>
              </div>
              {r.mode === "cloud" && r.has_credential && (
                <Button size="sm" variant="outline" disabled={busy === r.id} onClick={() => act(r.id, () => callApi(`/api/me/integrations/${r.id}/sync`, { body: {} }))}>
                  {busy === r.id ? <Loader2 className="animate-spin" /> : <RefreshCw />} Sync now
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                disabled={busy === r.id}
                onClick={() => {
                  const deleteData = confirm(
                    `${r.mode === "cloud" ? "Revoke and delete the stored key." : "Remove this integration."}\n\nAlso delete the usage data it uploaded? OK = delete data, Cancel = keep data.`,
                  );
                  void act(r.id, () => callApi(`/api/me/integrations/${r.id}${deleteData ? "?delete_data=1" : ""}`, { method: "DELETE" }));
                }}
              >
                <Trash2 /> {r.mode === "cloud" ? "Revoke" : "Remove"}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {error && <Alert variant="destructive">{error}</Alert>}
      <CloudKeyForm onDone={() => router.refresh()} />
    </div>
  );
}

function CloudKeyForm({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<"openai_api" | "anthropic_api" | "cursor">("openai_api");
  const [key, setKey] = useState("");
  const [email, setEmail] = useState("");
  const [teamWide, setTeamWide] = useState(false);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  if (!open) {
    return (
      <Button variant="outline" onClick={() => setOpen(true)}>
        <CloudUpload /> Add a cloud-sync key (optional)
      </Button>
    );
  }
  return (
    <form
      className="space-y-4 rounded-lg border p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setMsg(null);
        try {
          const r = await callApi<{ status: string }>("/api/me/integrations/cloud", {
            body: { source, api_key: key, email: email || undefined, team_wide: source === "cursor" ? teamWide : undefined, acknowledge_risk: true },
          });
          setKey("");
          setMsg({ ok: true, text: r.status === "duplicate" ? "Connected, but this organization is already connected to another account, so it counts only once." : "Connected. The first sync is running; data appears in a minute or two." });
          onDone();
        } catch (err) {
          setMsg({ ok: false, text: err instanceof ClientApiError ? err.message : "Could not connect." });
        } finally {
          setBusy(false);
        }
      }}
    >
      <Alert variant="warning">
        <AlertTriangle /> <strong>Admin keys are powerful.</strong> They can read (and for some providers manage) your whole organization.
        We encrypt the key with a per-user key (envelope encryption), never log it and never show it again, and you can revoke it
        here in one click — but the safest option is the local collector, which keeps keys on your machine.
        Cloud-synced data is marked <em>verified</em> because we pulled it from the provider ourselves.
      </Alert>
      <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
        <div className="space-y-2">
          <Label htmlFor="cloud-source">Provider</Label>
          <Select id="cloud-source" value={source} onChange={(e) => setSource(e.target.value as typeof source)} className="w-full">
            <option value="openai_api">OpenAI (Admin key)</option>
            <option value="anthropic_api">Anthropic (sk-ant-admin…)</option>
            <option value="cursor">Cursor (team Admin API)</option>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="cloud-key">Admin key</Label>
          <Input id="cloud-key" type="password" autoComplete="off" spellCheck={false} value={key} onChange={(e) => setKey(e.target.value)} required />
        </div>
      </div>
      {source === "cursor" && (
        <div className="space-y-2">
          <Label htmlFor="cloud-email">Your Cursor account email (filter)</Label>
          <Input id="cloud-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={teamWide} placeholder="Only your own events are counted" />
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={teamWide} onChange={(e) => setTeamWide(e.target.checked)} /> Count the whole team instead (solo teams only)
          </label>
          <p className="text-xs text-muted-foreground">Stored only inside the encrypted credential, used as an API filter, never displayed.</p>
        </div>
      )}
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-1" />
        I understand this stores an encrypted admin key on TokenRank&apos;s servers and that I can revoke it at any time.
      </label>
      {msg && <Alert variant={msg.ok ? "success" : "destructive"}>{msg.text}</Alert>}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy || !ack || !key}>{busy && <Loader2 className="animate-spin" />} Connect</Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </form>
  );
}
