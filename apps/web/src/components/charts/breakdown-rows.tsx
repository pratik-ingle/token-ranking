import { formatTokens, type BreakdownItem } from "@tokenrank/shared";
import { categoryColor } from "./series";

/**
 * Row layout: label · 10px bar scaled to the largest item · value + share.
 * Category bars use the category colour; app bars use ink.
 */
export function BreakdownRows({ items, kind, label }: { items: BreakdownItem[]; kind: "category" | "app"; label: string }) {
  if (!items.length) return <p className="text-sm text-muted-foreground">No usage yet.</p>;
  const max = Math.max(...items.map((i) => i.total_tokens));
  const total = items.reduce((s, i) => s + i.total_tokens, 0);
  return (
    <ul className="space-y-2.5" aria-label={label}>
      {items.map((i) => {
        const share = total > 0 ? i.total_tokens / total : 0;
        return (
          <li key={i.key} className="grid grid-cols-[7.5em_1fr_auto] items-center gap-3 text-sm">
            <span className="truncate">{i.label}</span>
            <span aria-hidden className="h-2.5 rounded-full bg-muted">
              <span
                className="block h-full rounded-full"
                style={{
                  width: `${Math.max(1, (i.total_tokens / max) * 100)}%`,
                  background: kind === "category" ? categoryColor(i.key) : "var(--foreground)",
                }}
              />
            </span>
            <span className="min-w-[6.5em] text-right tabular">
              {formatTokens(i.total_tokens)} <span className="text-muted-foreground">{share < 0.01 && share > 0 ? "<1" : Math.round(share * 100)}%</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
