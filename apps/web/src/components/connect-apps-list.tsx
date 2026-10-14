"use client";

import { type Source } from "@tokenrank/shared";
import { Check, Copy, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { callApi, ClientApiError } from "@/lib/client-api";
import type { CatalogEntry } from "@/lib/integrations-catalog";
import { timeAgo } from "@/lib/utils";
import { Button, buttonVariants } from "./ui/button";
import { useToast } from "./ui/toast";

export interface IntegrationStatus {
  id: string;
  mode: "local" | "cloud" | "upload";
  status: string;
  status_detail: string | null;
  last_synced_at: string | null;
}

export interface ConnectRow {
  entry: CatalogEntry;
  integrations: IntegrationStatus[];
  /** Local log sources: rows uploaded in the last 30 days count as connected. */
  recent: boolean;
  /** For rows that share another row's source (OTel): whether that one is connected. */
  sharedConnected?: boolean;
}

const MODE = { local: "collector", cloud: "cloud sync", upload: "CSV upload" } as const;

export function ConnectAppsList({
  rows,
  unsupported,
  serverFlag,
  otelEndpoint,
}: {
  rows: ConnectRow[];
  unsupported: ReadonlyArray<{ name: string; reason: string }>;
  serverFlag: string;
  otelEndpoint: string;
}) {
  return (
    <ul className="divide-y rounded-xl border bg-card">
      {rows.map((r) => (
        <AppRow key={r.entry.id} row={r} serverFlag={serverFlag} otelEndpoint={otelEndpoint} />
      ))}
      {unsupported.map((u) => (
        <li key={u.name} className="p-4 text-muted-foreground">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{u.name}</span>
            <span className="rounded-full border px-2 py-0.5 text-xs">Not available yet</span>
          </div>
          <p className="mt-1 text-sm">{u.reason}</p>
        </li>
      ))}
    </ul>
  );
}

function AppRow({
  row,
  serverFlag,
  otelEndpoint,
}: {
  row: ConnectRow;
  serverFlag: string;
  otelEndpoint: string;
}) {
  const { entry, integrations, recent } = row;
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const panelId = useId();
  const toast = useToast();
  const connected = integrations.length > 0 || recent;
  const command = entry.connect.kind === "copy" ? entry.connect.command.replace("{server}", serverFlag) : "";

  const copy = async () => {
    await navigator.clipboard.writeText(command).catch(() => {});
    setCopied(true);
    setOpen(true);
    toast("Command copied. Run it in your terminal.");
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <li className="grid gap-3 p-4 sm:grid-cols-[1fr_auto]">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-semibold">{entry.name}</h3>
          <span className="rounded-full border px-2 py-0.5 text-xs text-ink-2">{entry.method}</span>
        </div>
        <p className="text-sm text-ink-2">{entry.reads}</p>
        <p className="text-xs text-muted-foreground">Category: {entry.categoryRule}</p>

        {entry.sharesStatusWith ? (
          row.sharedConnected && <p className="text-sm text-muted-foreground">Shares the Claude Code connection above. Use this or the collector, not both.</p>
        ) : (
          <div className="space-y-1.5 pt-1">
            {integrations.map((i) => (
              <StatusLine key={i.id} name={entry.name} source={entry.source} integration={i} showMode={integrations.length > 1} />
            ))}
            {integrations.length === 0 && recent && (
              <p className="text-sm font-medium text-success">
                <Check className="mr-1 inline size-4 align-[-3px]" aria-hidden />
                Connected · uploads in the last 30 days
              </p>
            )}
          </div>
        )}

        {open && entry.connect.kind === "copy" && (
          <div id={panelId} className="mt-2 space-y-1">
            <code className="block overflow-x-auto rounded-md border bg-muted px-3 py-2 font-mono text-xs whitespace-nowrap">{command}</code>
            <p className="text-xs text-muted-foreground">{copied ? "Copied. " : ""}Run it in your terminal; keys and logs stay on your machine.</p>
          </div>
        )}
        {open && entry.connect.kind === "otel" && (
          <div id={panelId} className="mt-2 space-y-1">
            <pre className="overflow-x-auto rounded-md border bg-muted p-3 text-xs">{`CLAUDE_CODE_ENABLE_TELEMETRY=1
OTEL_METRICS_EXPORTER=otlp
OTEL_EXPORTER_OTLP_PROTOCOL=http/json
OTEL_EXPORTER_OTLP_ENDPOINT=${otelEndpoint}
OTEL_EXPORTER_OTLP_HEADERS="Authorization=Bearer <ingest token>"`}</pre>
            <p className="text-xs text-muted-foreground">
              Create the ingest token in <Link href="/settings#tokens" className="underline underline-offset-2">Settings</Link>. Only the token-usage counter is read.
            </p>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-start gap-x-3 gap-y-1 sm:flex-col sm:items-end">
        {!connected && entry.connect.kind === "copy" && (
          <Button size="sm" onClick={copy} aria-controls={panelId} aria-expanded={open}>
            {copied ? <Check aria-hidden /> : <Copy aria-hidden />} Connect
          </Button>
        )}
        {!connected && entry.connect.kind === "link" && (
          <Link href={entry.connect.href} className={buttonVariants({ size: "sm" })}>
            Connect <span className="sr-only">{entry.name}: </span>
            <span className="sr-only">{entry.connect.label}</span>
          </Link>
        )}
        {entry.connect.kind === "otel" && (
          <Button size="sm" variant={row.sharedConnected ? "outline" : "default"} aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((v) => !v)}>
            {open ? "Hide setup" : "Set up"}
          </Button>
        )}
        {!connected && entry.alt && (
          <Link href={entry.alt.href} className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
            {entry.alt.label}
          </Link>
        )}
      </div>
    </li>
  );
}

function StatusLine({
  name,
  source,
  integration: i,
  showMode,
}: {
  name: string;
  source: Source;
  integration: IntegrationStatus;
  showMode: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const [deleteData, setDeleteData] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const wasConfirming = useRef(false);
  const via = showMode ? ` via ${MODE[i.mode]}` : "";

  // Return focus to "Disconnect" when the confirm step is cancelled.
  useEffect(() => {
    if (wasConfirming.current && !confirming) trigger.current?.focus();
    wasConfirming.current = confirming;
  }, [confirming]);

  const disconnect = async () => {
    setBusy(true);
    setError(null);
    try {
      await callApi(`/api/me/integrations/${i.id}${deleteData ? "?delete_data=1" : ""}`, { method: "DELETE" });
      toast(`${name} disconnected${deleteData ? " and its data deleted" : ""}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof ClientApiError ? e.message : "Could not disconnect.");
      setBusy(false);
    }
  };

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        {i.status === "error" ? (
          <span className="font-medium text-destructive">
            Error{via}
            {i.status_detail ? ` · ${i.status_detail}` : ""}
          </span>
        ) : i.status === "duplicate" ? (
          <span className="font-medium text-ink-2" title={i.status_detail ?? undefined}>
            Counted once{via} · {i.status_detail ?? "this organization is connected to another account"}
          </span>
        ) : (
          <span className="font-medium text-success">
            <Check className="mr-1 inline size-4 align-[-3px]" aria-hidden />
            Connected{via} · last sync {timeAgo(i.last_synced_at)}
          </span>
        )}
        {!confirming && (
          <button ref={trigger} type="button" className="text-sm text-ink-2 underline-offset-2 hover:text-foreground hover:underline" onClick={() => setConfirming(true)}>
            Disconnect<span className="sr-only"> {name}</span>
          </button>
        )}
      </div>
      {confirming && (
        <div role="group" aria-label={`Disconnect ${name}`} className="space-y-2 rounded-lg border bg-muted/50 p-3 text-sm">
          <p>
            Disconnect {name}
            {via}?{" "}
            {i.mode === "local" && (
              <span className="text-muted-foreground">
                A scheduled collector reconnects on its next sync; run <code className="text-xs">npx tokenrank-collector disable {source}</code> to stop it.
              </span>
            )}
            {i.mode === "cloud" && <span className="text-muted-foreground">The stored admin key is deleted.</span>}
          </p>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={deleteData} onChange={(e) => setDeleteData(e.target.checked)} /> Also delete the usage it uploaded
          </label>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex gap-2">
            <Button size="sm" variant="destructive" disabled={busy} onClick={disconnect}>
              {busy && <Loader2 className="animate-spin" aria-hidden />} Disconnect
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirming(false)} autoFocus>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

