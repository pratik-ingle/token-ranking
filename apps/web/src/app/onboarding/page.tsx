import { UNSUPPORTED_INTEGRATIONS } from "@tokenrank/shared";
import { Ban, Cloud, FileSpreadsheet, Laptop, Radio, Webhook } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CodeLine } from "@/components/copy-button";
import { FirstSyncWaiter } from "@/components/first-sync-waiter";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { INTEGRATIONS, type CatalogEntry } from "@/lib/integrations-catalog";
import { env } from "@/server/env";
import { getCurrentUser } from "@/server/session";

export const metadata: Metadata = { title: "Connect your tools" };

const HOW: Record<CatalogEntry["how"], { label: string; icon: typeof Laptop }> = {
  collector: { label: "Local collector", icon: Laptop },
  "collector-or-cloud": { label: "Collector or cloud sync", icon: Cloud },
  "csv-or-api": { label: "CSV upload or Admin API", icon: FileSpreadsheet },
  otel: { label: "OpenTelemetry", icon: Radio },
  api: { label: "CSV or ingestion API", icon: Webhook },
};

export default async function OnboardingPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/signup?next=/onboarding");
  const origin = env.appOrigin;
  const serverFlag = origin === "http://localhost:3000" ? "" : ` --server ${origin}`;

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Connect your tools, {user.username}</h1>
        <p className="text-muted-foreground">
          The fastest path is the open-source collector. It runs on your machine, reads token counts from local logs (and provider
          usage APIs if you give it admin keys), and uploads only daily totals. Keys never leave your machine.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><span className="flex size-6 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground">1</span> Run the collector</CardTitle>
          <CardDescription>Pairs with your account via a short code, auto-detects Claude Code and Codex logs, runs the first sync and prints your rank.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <CodeLine code={`npx tokenrank-collector login${serverFlag}`} />
          <p className="text-xs text-muted-foreground">
            Want to see exactly what would be sent first? <code className="rounded bg-muted px-1">npx tokenrank-collector sync --dry-run</code> prints the
            full JSON payload without uploading. Schedule it with <code className="rounded bg-muted px-1">npx tokenrank-collector schedule</code>.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><span className="flex size-6 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground">2</span> See your rank</CardTitle>
        </CardHeader>
        <CardContent>
          <FirstSyncWaiter />
        </CardContent>
      </Card>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold">All integrations</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {INTEGRATIONS.map((i) => {
            const how = HOW[i.how];
            return (
              <Card key={i.id}>
                <CardHeader>
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="text-base">{i.name}</CardTitle>
                    <Badge variant="secondary"><how.icon /> {how.label}</Badge>
                  </div>
                  <CardDescription>{i.description}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                    {i.details.map((d) => <li key={d}>{d}</li>)}
                  </ul>
                  <p className="text-xs text-muted-foreground">Trust: {i.trust}</p>
                  {i.how === "csv-or-api" && <Link href="/import" className="text-primary hover:underline">Upload a Cursor CSV →</Link>}
                  {i.how === "collector-or-cloud" && <Link href="/settings#integrations" className="text-primary hover:underline">Or set up cloud sync →</Link>}
                  {i.how === "otel" && (
                    <pre className="whitespace-pre-wrap break-all rounded-md bg-muted p-2 text-xs">{`CLAUDE_CODE_ENABLE_TELEMETRY=1
OTEL_METRICS_EXPORTER=otlp
OTEL_EXPORTER_OTLP_PROTOCOL=http/json
OTEL_EXPORTER_OTLP_ENDPOINT=${origin}/api/v1/otlp
OTEL_EXPORTER_OTLP_HEADERS="Authorization=Bearer <ingest token>"`}</pre>
                  )}
                  {i.how === "api" && <Link href="/docs/api" className="text-primary hover:underline">API docs →</Link>}
                </CardContent>
              </Card>
            );
          })}
          {UNSUPPORTED_INTEGRATIONS.map((u) => (
            <Card key={u.name} className="border-dashed bg-muted/30">
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-base text-muted-foreground">{u.name}</CardTitle>
                  <Badge variant="outline"><Ban /> Not supported yet</Badge>
                </div>
                <CardDescription>{u.reason}</CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
