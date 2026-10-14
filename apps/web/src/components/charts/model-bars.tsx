import { formatTokens, type BreakdownItem } from "@tokenrank/shared";

/** Top models: one series, so one colour for every bar; values labelled at the bar end. */
export function ModelBars({ items }: { items: BreakdownItem[] }) {
  const max = Math.max(1, ...items.map((i) => i.total_tokens));
  if (!items.length) return <p className="text-sm text-muted-foreground">No usage yet.</p>;
  return (
    <ol className="space-y-2.5">
      {items.map((i, idx) => (
        <li key={i.key} className="grid grid-cols-[1.25rem_1fr_auto] items-center gap-x-2 text-sm">
          <span className="tabular text-muted-foreground">{idx + 1}</span>
          <div className="min-w-0">
            <div className="truncate font-mono text-xs">{i.key}</div>
            <div className="mt-1 h-1.5 rounded-full bg-muted">
              <div className="h-full rounded-full" style={{ width: `${Math.max(2, (i.total_tokens / max) * 100)}%`, background: "var(--foreground)" }} />
            </div>
          </div>
          <span className="tabular text-muted-foreground">{formatTokens(i.total_tokens)}</span>
        </li>
      ))}
    </ol>
  );
}
