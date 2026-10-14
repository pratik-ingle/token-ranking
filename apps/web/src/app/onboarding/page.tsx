import { localDate, UNSUPPORTED_INTEGRATIONS, USAGE_ROW_FIELDS, type UsageRow } from "@tokenrank/shared";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ConnectAppsList, type ConnectRow } from "@/components/connect-apps-list";
import { CodeLine } from "@/components/copy-button";
import { FirstSyncWaiter } from "@/components/first-sync-waiter";
import { getDb } from "@/db/client";
import { INTEGRATIONS, LOCAL_LOG_SOURCES } from "@/lib/integrations-catalog";
import { env } from "@/server/env";
import { connectedSources, listIntegrations } from "@/server/integrations";
import { getCurrentUser } from "@/server/session";
import { getTodayRows } from "@/server/usage-rows";

export const metadata: Metadata = { title: "Connect apps" };
export const dynamic = "force-dynamic";

const NEVER_SENT = [
  "Prompts and replies",
  "Code, files or file paths",
  "API keys: they stay on your machine, or are stored encrypted if you use cloud sync",
  "Your name or email",
];

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={`step-${n}`} className="space-y-4">
      <div className="flex items-center gap-3">
        <span aria-hidden className="flex size-7 shrink-0 items-center justify-center rounded-full bg-foreground text-sm font-semibold text-background">
          {n}
        </span>
        <h2 id={`step-${n}`} className="text-[22px] leading-tight font-semibold">
          <span className="sr-only">Step {n}: </span>
          {title}
        </h2>
      </div>
      {children}
    </section>
  );
}

export default async function ConnectPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/signup?next=/onboarding");
  const db = getDb();
  const [integrations, connected, todayRows] = await Promise.all([listIntegrations(db, user.id), connectedSources(db, user), getTodayRows(db, user)]);
  const origin = env.appOrigin;
  const serverFlag = origin === "http://localhost:3000" ? "" : ` --server ${origin}`;

  const rows: ConnectRow[] = INTEGRATIONS.map((entry) => {
    const own = entry.sharesStatusWith ? [] : integrations.filter((i) => i.source === entry.source && i.status !== "revoked");
    return {
      entry,
      integrations: own.map((i) => ({ id: i.id, mode: i.mode, status: i.status, status_detail: i.status_detail, last_synced_at: i.last_synced_at })),
      recent: !entry.sharesStatusWith && LOCAL_LOG_SOURCES.includes(entry.source) && connected.has(entry.source),
      sharedConnected: entry.sharesStatusWith ? connected.has(entry.source) : undefined,
    };
  });

  const today = localDate(Date.now(), user.timezone);
  const example: UsageRow = {
    date: today, source: "claude_code", model: "claude-sonnet-4-5", category: "coding",
    input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, request_count: 0, image_count: 0,
  };
  const payload = JSON.stringify(todayRows.length ? todayRows : [example], USAGE_ROW_FIELDS as unknown as string[], 2);

  return (
    <div className="grid gap-10 min-[900px]:grid-cols-[1.35fr_1fr] min-[900px]:items-start">
      <div className="min-w-0 space-y-10">
        <header className="space-y-2">
          <h1 className="font-expanded text-[clamp(26px,4vw,40px)] leading-tight">Connect apps</h1>
          <p className="text-ink-2">
            The collector runs on your machine, reads token counts from your tools, and uploads daily totals. Nothing else leaves your computer.
          </p>
        </header>

        <Step n={1} title="Run the collector">
          <CodeLine code={`npx tokenrank-collector login${serverFlag}`} />
          <p className="text-sm text-muted-foreground">
            It pairs with your account using a short code, finds your Claude Code and Codex logs, runs the first sync and prints your rank. To
            see exactly what would be sent first, run <code className="rounded bg-muted px-1">npx tokenrank-collector sync --dry-run</code>. To keep it
            up to date, <code className="rounded bg-muted px-1">npx tokenrank-collector schedule</code> prints a cron, launchd or systemd entry.
          </p>
        </Step>

        <Step n={2} title="Connect your apps">
          <ConnectAppsList rows={rows} unsupported={UNSUPPORTED_INTEGRATIONS} serverFlag={serverFlag} otelEndpoint={`${origin}/api/v1/otlp`} />
        </Step>

        <Step n={3} title="See your rank">
          <FirstSyncWaiter />
        </Step>
      </div>

      <aside
        aria-labelledby="sent-heading"
        className="space-y-5 rounded-xl border bg-card p-5 min-[900px]:sticky min-[900px]:top-[calc(var(--header-h)+16px)]"
      >
        <div className="space-y-1">
          <h2 id="sent-heading" className="font-semibold">What gets sent today</h2>
          <p className="text-sm text-ink-2">
            {todayRows.length
              ? `Your ${todayRows.length} stored row${todayRows.length === 1 ? "" : "s"} for ${today}, exactly as uploaded.`
              : "Nothing uploaded yet today."}
          </p>
        </div>
        {!todayRows.length && <p className="text-xs text-muted-foreground">An upload looks like this example row:</p>}
        <pre
          tabIndex={0}
          aria-label={todayRows.length ? "Today's rows as JSON" : "Example row as JSON"}
          className="max-h-[50vh] overflow-auto rounded-lg border bg-muted p-3 font-mono text-xs leading-relaxed"
        >
          {payload}
        </pre>
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Never sent</h3>
          <ul className="space-y-1.5 text-sm text-ink-2">
            {NEVER_SENT.map((n) => (
              <li key={n} className="flex gap-2">
                <span aria-hidden className="text-muted-foreground">×</span>
                {n}
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  );
}
