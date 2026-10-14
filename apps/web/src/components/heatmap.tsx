"use client";

import {
  addDays,
  buildHeatmap,
  dayOfWeek,
  formatInteger,
  formatTokens,
  heatmapRange,
  MONTH_SHORT,
  parseDate,
  type Category,
  type HeatmapCell,
  type HeatmapDay,
} from "@tokenrank/shared";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { CATEGORY_SHORT } from "@/lib/categories";
import { cn } from "@/lib/utils";
import { CATEGORY_ORDER, categoryColor } from "./charts/series";

const CELL = 12;
const GAP = 3;
const LEFT = 28;
const TOP = 18;
const STEP = CELL + GAP;
const DAY_LABELS: Record<number, string> = { 1: "Mon", 3: "Wed", 5: "Fri" };
const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
// Category ramps: the category colour mixed into the empty-cell colour.
const MIX = [0, 30, 55, 78, 100];

/** "Mon, 13 Oct 2026" — fixed English so server and client agree. */
export function longDate(date: string): string {
  const d = new Date(parseDate(date));
  return `${WEEKDAY[dayOfWeek(date)]}, ${d.getUTCDate()} ${MONTH_SHORT[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function clamp(date: string, start: string, end: string): string {
  return date < start ? start : date > end ? end : date;
}

type Selection = Category | "all";

/**
 * GitHub-style heatmap of daily tokens (7 rows × ~53 week columns) with a
 * category switch. Hover, click or arrow keys move a selected day whose
 * details are announced in a persistent caption.
 */
export function Heatmap({
  days,
  today,
  year,
  label,
  title,
  footer,
}: {
  days: HeatmapDay[];
  today: string;
  year: number | null;
  label: string;
  title: ReactNode;
  /** Rendered under the legend (e.g. the year picker). */
  footer?: ReactNode;
}) {
  const { start, end } = heatmapRange(today, year);
  const categories = useMemo(() => {
    const present = new Set<Category>();
    for (const d of days) for (const [k, v] of Object.entries(d.by_category ?? {})) if ((v ?? 0) > 0) present.add(k as Category);
    return CATEGORY_ORDER.filter((c) => present.has(c));
  }, [days]);
  const [selection, setSelection] = useState<Selection>("all");
  const [selected, setSelected] = useState(() => clamp(today, start, end));
  const [hovered, setHovered] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);

  const byDate = useMemo(() => new Map(days.map((d) => [d.date, d])), [days]);
  const grid = useMemo(
    () =>
      buildHeatmap({
        days: days.map((d) => ({ date: d.date, total_tokens: selection === "all" ? d.total_tokens : (d.by_category?.[selection] ?? 0) })),
        today,
        year,
      }),
    [days, selection, today, year],
  );
  const position = useMemo(() => {
    const m = new Map<string, { c: number; r: number; cell: HeatmapCell }>();
    grid.weeks.forEach((w, c) => w.forEach((cell, r) => cell.in_range && m.set(cell.date, { c, r, cell })));
    return m;
  }, [grid]);

  // Keep the selection inside the range when the year changes.
  useEffect(() => setSelected((s) => clamp(s, start, end)), [start, end]);
  // Show the latest weeks first on narrow screens.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [year]);

  const fill = (level: number): string => {
    if (selection === "all" || level === 0) return `var(--heat-${level})`;
    return `color-mix(in oklab, ${categoryColor(selection)} ${MIX[level]}%, var(--heat-0))`;
  };

  const focusDate = (date: string) => {
    const next = clamp(date, start, end);
    setSelected(next);
    requestAnimationFrame(() => {
      svg.current?.querySelector<SVGRectElement>(`[data-date="${next}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, () => string> = {
      ArrowUp: () => addDays(selected, -1),
      ArrowDown: () => addDays(selected, 1),
      ArrowLeft: () => addDays(selected, -7),
      ArrowRight: () => addDays(selected, 7),
      Home: () => start,
      End: () => end,
    };
    const move = moves[e.key];
    if (!move) return;
    e.preventDefault();
    focusDate(move());
  };

  const shown = hovered ?? selected;
  const sel = position.get(selected);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {title}
      {categories.length > 0 && (
        <div className="flex flex-wrap gap-1 rounded-md border bg-card p-0.5 text-sm" role="group" aria-label="Category shown in the heatmap">
          {(["all", ...categories] as Selection[]).map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={selection === c}
              onClick={() => setSelection(c)}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-[8px] px-2.5",
                selection === c ? "bg-foreground font-medium text-background" : "text-ink-2 hover:text-foreground",
              )}
            >
              {c !== "all" && <span aria-hidden className="size-2 rounded-full" style={{ background: categoryColor(c) }} />}
              {c === "all" ? "All" : CATEGORY_SHORT[c]}
            </button>
          ))}
        </div>
      )}
      </div>

      <div
        ref={scroller}
        tabIndex={0}
        role="group"
        aria-label={`${label}. Use the arrow keys to choose a day: up and down move one day, left and right move one week, Home and End jump to the first and last day.`}
        onKeyDown={onKeyDown}
        className="overflow-x-auto rounded-md pb-1 focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        <svg ref={svg} width={LEFT + grid.weeks.length * STEP} height={TOP + 7 * STEP} className="block" aria-hidden>
          {grid.month_labels.map((m) => (
            <text key={`${m.column}-${m.label}`} x={LEFT + m.column * STEP} y={10} fontSize={10} fill="var(--chart-axis)">
              {m.label}
            </text>
          ))}
          {Object.entries(DAY_LABELS).map(([r, l]) => (
            <text key={l} x={0} y={TOP + Number(r) * STEP + CELL - 2} fontSize={10} fill="var(--chart-axis)">
              {l}
            </text>
          ))}
          {grid.weeks.map((week, c) =>
            week.map((cell, r) =>
              cell.in_range ? (
                <rect
                  key={cell.date}
                  data-date={cell.date}
                  x={LEFT + c * STEP}
                  y={TOP + r * STEP}
                  width={CELL}
                  height={CELL}
                  rx={2}
                  fill={fill(cell.level)}
                  opacity={cell.future ? 0.35 : 1}
                  className="cursor-pointer"
                  onMouseEnter={() => setHovered(cell.date)}
                  onMouseLeave={() => setHovered(null)}
                  onClick={() => focusDate(cell.date)}
                />
              ) : null,
            ),
          )}
          {sel && (
            <rect
              x={LEFT + sel.c * STEP - 1.5}
              y={TOP + sel.r * STEP - 1.5}
              width={CELL + 3}
              height={CELL + 3}
              rx={3}
              fill="none"
              stroke="var(--foreground)"
              strokeWidth={2}
              pointerEvents="none"
            />
          )}
        </svg>
      </div>

      <p aria-live="polite" className="min-h-5 text-sm">
        <DayCaption date={shown} day={byDate.get(shown)} selection={selection} />
      </p>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {formatTokens(grid.total_tokens)} tokens{selection === "all" ? "" : ` on ${CATEGORY_SHORT[selection].toLowerCase()}`} ·{" "}
          {formatInteger(grid.active_days)} active day{grid.active_days === 1 ? "" : "s"}
        </span>
        <span className="flex items-center gap-1" aria-hidden>
          Less
          {[0, 1, 2, 3, 4].map((l) => (
            <span key={l} className="inline-block size-3 rounded-[2px]" style={{ background: fill(l) }} />
          ))}
          More
        </span>
      </div>
      {footer}
    </div>
  );
}

function DayCaption({ date, day, selection }: { date: string; day: HeatmapDay | undefined; selection: Selection }) {
  const when = <strong className="font-semibold">{longDate(date)}:</strong>;
  if (selection !== "all") {
    const v = day?.by_category?.[selection] ?? 0;
    return (
      <>
        {when} {v ? `${formatInteger(v)} tokens` : "no tokens"} on {CATEGORY_SHORT[selection].toLowerCase()}
      </>
    );
  }
  const total = day?.total_tokens ?? 0;
  if (!total) return <>{when} no tokens</>;
  const parts = Object.entries(day?.by_category ?? {})
    .map(([k, v]) => ({ k: k as Category, share: (v ?? 0) / total }))
    .filter((p) => p.share >= 0.05)
    .sort((a, b) => b.share - a.share)
    .map((p) => `${CATEGORY_SHORT[p.k].toLowerCase()} ${Math.round(p.share * 100)}%`);
  return (
    <>
      {when} {formatInteger(total)} tokens{parts.length ? ` (${parts.join(", ")})` : ""}
    </>
  );
}
