import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { DangerZone } from "@/components/settings/danger-zone";
import { IntegrationsSettings } from "@/components/settings/integrations-settings";
import { ProfileSettings } from "@/components/settings/profile-settings";
import { SecuritySettings } from "@/components/settings/security-settings";
import { TokensSettings } from "@/components/settings/tokens-settings";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getDb } from "@/db/client";
import { ingestTokens, passkeys } from "@/db/schema";
import { listIntegrations } from "@/server/integrations";
import { getCurrentUser, isAdmin } from "@/server/session";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/settings");
  const db = getDb();
  const [integrationRows, tokens, pk] = await Promise.all([
    listIntegrations(db, user.id),
    db
      .select({ id: ingestTokens.id, name: ingestTokens.name, prefix: ingestTokens.tokenPrefix, scopes: ingestTokens.scopes, created_at: ingestTokens.createdAt, last_used_at: ingestTokens.lastUsedAt })
      .from(ingestTokens)
      .where(and(eq(ingestTokens.userId, user.id), isNull(ingestTokens.revokedAt)))
      .orderBy(desc(ingestTokens.createdAt)),
    db.select({ n: sql<number>`count(*)::int` }).from(passkeys).where(eq(passkeys.userId, user.id)),
  ]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-end justify-between">
        <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
        <div className="flex gap-4 text-sm">
          {isAdmin(user) && <Link href="/admin/review" className="text-primary hover:underline">Review queue</Link>}
          <Link href="/import" className="text-primary hover:underline">Import CSV</Link>
          <Link href={`/u/${user.username}`} className="text-primary hover:underline">My profile</Link>
        </div>
      </div>
      <Section id="profile" title="Profile" description="Your username is your only identity here.">
        <ProfileSettings visibility={user.visibility} timezone={user.timezone} />
      </Section>
      <Section id="integrations" title="Connected integrations" description="Where your token counts come from. Local integrations appear after the first upload.">
        <IntegrationsSettings
          rows={integrationRows.map((r) => ({ ...r }))}
        />
      </Section>
      <Section id="tokens" title="Ingest tokens" description="Personal tokens for the collector, the MCP server, OpenTelemetry or your own connectors. Stored only as hashes.">
        <TokensSettings rows={tokens.map((t) => ({ ...t, created_at: t.created_at.toISOString(), last_used_at: t.last_used_at?.toISOString() ?? null }))} />
      </Section>
      <Section id="security" title="Security" description="Passkeys first; a password is an optional fallback.">
        <SecuritySettings passkeyCount={Number(pk[0]?.n ?? 0)} hasPassword={user.hasPassword} hasRecoveryEmail={user.hasRecoveryEmail} />
      </Section>
      <Section id="data" title="Your data">
        <DangerZone username={user.username} />
      </Section>
    </div>
  );
}

function Section({ id, title, description, children }: { id: string; title: string; description?: string; children: React.ReactNode }) {
  return (
    <Card id={id} className="scroll-mt-20">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
