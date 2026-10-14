import { formatInteger, formatTokens, SOURCE_LABELS, type Source } from "@tokenrank/shared";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ReviewActions } from "@/components/review-actions";
import { Badge } from "@/components/ui/badge";
import { getDb } from "@/db/client";
import { env } from "@/server/env";
import { listFlagged } from "@/server/review";
import { getCurrentUser, isAdmin } from "@/server/session";

export const metadata: Metadata = { title: "Review queue" };

export default async function ReviewPage() {
  const me = await getCurrentUser();
  if (!isAdmin(me)) notFound();
  const rows = await listFlagged(getDb());
  const limits = env.sanityLimits;
  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-semibold tracking-tight">Review queue</h1>
      <p className="text-sm text-muted-foreground">
        Days whose per-source total exceeded the sanity limit. They are stored but excluded from rankings until approved. Approval covers totals
        up to the current value; a higher re-sync is flagged again.
      </p>
      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
            <tr><th className="px-4 py-2">User</th><th className="px-4 py-2">Date</th><th className="px-4 py-2">Source</th><th className="px-4 py-2 text-right">Tokens</th><th className="px-4 py-2 text-right">Limit</th><th className="px-4 py-2">Status</th><th className="px-4 py-2" /></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.user_id}${r.date}${r.source}`} className="border-b last:border-0">
                <td className="px-4 py-2 font-medium">{r.username}</td>
                <td className="px-4 py-2 tabular">{r.date}</td>
                <td className="px-4 py-2">{SOURCE_LABELS[r.source as Source] ?? r.source}</td>
                <td className="px-4 py-2 text-right tabular" title={formatInteger(r.total_tokens)}>{formatTokens(r.total_tokens)}</td>
                <td className="px-4 py-2 text-right tabular text-muted-foreground">{formatTokens(limits[r.source as Source] ?? 0)}</td>
                <td className="px-4 py-2">{r.decision === "rejected" ? <Badge variant="destructive">rejected</Badge> : <Badge variant="warning">pending</Badge>}</td>
                <td className="px-4 py-2"><ReviewActions userId={r.user_id} date={r.date} source={r.source} /></td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">Nothing to review.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
