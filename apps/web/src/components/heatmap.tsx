"use client";

import { formatInteger, formatTokens, heatmapTooltip, type HeatmapCell, type HeatmapGrid } from "@tokenrank/shared";
import { useRef, useState } from "react";

const CELL = 12;
const GAP = 3;
const LEFT = 28;
const TOP = 18;
const DAY_LABELS: Record<number, string> = { 1: "Mon", 3: "Wed", 5: "Fri" };

/**
 * GitHub-style contribution heatmap: 7 rows (Sun→Sat) × 53 week columns,
 * five levels from quartiles of the user's own non-zero days (one sequential
 * hue). Hover or focus a day for "2.3M tokens on Mar 4, 2026".
 */
export function Heatmap({ grid, caption }: { grid: HeatmapGrid; caption: string }) {
  const [hover, setHover] = useState<{ cell: HeatmapCell; x: number; y: number } | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const width = LEFT + grid.weeks.length * (CELL + GAP);
  const height = TOP + 7 * (CELL + GAP);

  const show = (cell: HeatmapCell, c: number, r: number) => {
    if (!cell.in_range) return;
    setHover({ cell, x: LEFT + c * (CELL + GAP) + CELL / 2, y: TOP + r * (CELL + GAP) });
  };

  return (
    <div className="space-y-2">
      <div ref={wrap} className="relative overflow-x-auto pb-1">
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="block" role="img" aria-label={caption}>
          {grid.month_labels.map((m) => (
            <text key={`${m.column}-${m.label}`} x={LEFT + m.column * (CELL + GAP)} y={10} fontSize={10} fill="var(--chart-axis)">
              {m.label}
            </text>
          ))}
          {Object.entries(DAY_LABELS).map(([r, label]) => (
            <text key={label} x={0} y={TOP + Number(r) * (CELL + GAP) + CELL - 2} fontSize={10} fill="var(--chart-axis)">
              {label}
            </text>
          ))}
          {grid.weeks.map((week, c) =>
            week.map((cell, r) =>
              cell.in_range ? (
                <rect
                  key={cell.date}
                  x={LEFT + c * (CELL + GAP)}
                  y={TOP + r * (CELL + GAP)}
                  width={CELL}
                  height={CELL}
                  rx={2}
                  fill={`var(--heat-${cell.level})`}
                  opacity={cell.future ? 0.35 : 1}
                  data-date={cell.date}
                  data-level={cell.level}
                  onMouseEnter={() => show(cell, c, r)}
                  onMouseLeave={() => setHover(null)}
                />
              ) : null,
            ),
          )}
        </svg>
        {hover ? (
          <div
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md border bg-card px-2 py-1 text-xs shadow-md"
            style={{ left: hover.x - (wrap.current?.scrollLeft ?? 0), top: hover.y - 4 }}
          >
            {heatmapTooltip(hover.cell)}
          </div>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {formatTokens(grid.total_tokens)} tokens · {formatInteger(grid.active_days)} active day{grid.active_days === 1 ? "" : "s"}
        </span>
        <span className="flex items-center gap-1" aria-hidden>
          Less
          {[0, 1, 2, 3, 4].map((l) => (
            <span key={l} className="inline-block size-[12px] rounded-[2px]" style={{ background: `var(--heat-${l})` }} />
          ))}
          More
        </span>
      </div>
    </div>
  );
}
