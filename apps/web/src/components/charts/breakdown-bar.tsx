"use client";

import { formatTokens, type BreakdownItem } from "@tokenrank/shared";
import { useState } from "react";
import { categoryColor, categoryIndex, seriesVar, slotFor } from "./series";

/**
 * Part-to-whole as one horizontal stacked bar plus a legend that doubles as
 * the table view (label, value, share). Segments sit in fixed slot order with
 * a 2px surface gap; hover/focus shows the exact value.
 */
export function BreakdownBar({ items, dimension, title }: { items: BreakdownItem[]; dimension: "source" | "category"; title: string }) {
  const [active, setActive] = useState<string | null>(null);
  const total = items.reduce((s, i) => s + i.total_tokens, 0);
  const order = (key: string) => (dimension === "category" ? categoryIndex(key) : slotFor("source", key));
  const colorOf = (key: string) => (dimension === "category" ? categoryColor(key) : seriesVar(slotFor("source", key)));
  const ordered = [...items].sort((a, b) => order(a.key) - order(b.key));
  if (total <= 0) return <p className="text-sm text-muted-foreground">No usage yet.</p>;
  const activeItem = ordered.find((i) => i.key === active);

  return (
    <figure className="space-y-3">
      <figcaption className="sr-only">{title}</figcaption>
      <div className="relative">
        <div className="flex h-3 w-full gap-[2px] overflow-hidden rounded-full" role="img" aria-label={`${title}: ${ordered.map((i) => `${i.label} ${Math.round((i.total_tokens / total) * 100)}%`).join(", ")}`}>
          {ordered.map((i) => (
            <div
              key={i.key}
              tabIndex={0}
              onMouseEnter={() => setActive(i.key)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(i.key)}
              onBlur={() => setActive(null)}
              className="h-full min-w-[3px] first:rounded-l-full last:rounded-r-full transition-opacity outline-none"
              style={{
                width: `${(i.total_tokens / total) * 100}%`,
                background: colorOf(i.key),
                opacity: active && active !== i.key ? 0.35 : 1,
              }}
            />
          ))}
        </div>
        <div aria-live="polite" className="pointer-events-none mt-1 h-4 text-xs text-muted-foreground">
          {activeItem ? `${activeItem.label}: ${formatTokens(activeItem.total_tokens)} tokens (${((activeItem.total_tokens / total) * 100).toFixed(1)}%)` : ""}
        </div>
      </div>
      <ul className="grid gap-1.5 text-sm">
        {ordered.map((i) => (
          <li
            key={i.key}
            className="flex items-center gap-2"
            onMouseEnter={() => setActive(i.key)}
            onMouseLeave={() => setActive(null)}
          >
            <span className="size-2.5 shrink-0 rounded-sm" style={{ background: colorOf(i.key) }} />
            <span className="truncate">{i.label}</span>
            <span className="ml-auto tabular text-muted-foreground">{formatTokens(i.total_tokens)}</span>
            <span className="w-12 text-right tabular text-muted-foreground">{((i.total_tokens / total) * 100).toFixed(1)}%</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}
