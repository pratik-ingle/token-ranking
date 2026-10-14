"use client";

import { formatHeatmapDate, formatTokens } from "@tokenrank/shared";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

interface Point {
  date: string;
  total_tokens: number;
}

function TooltipBox({ active, payload }: { active?: boolean; payload?: Array<{ payload: Point }> }) {
  const p = payload?.[0]?.payload;
  if (!active || !p) return null;
  return (
    <div className="rounded-md border bg-card px-2.5 py-1.5 text-xs shadow-md">
      <div className="font-medium">{formatTokens(p.total_tokens)} tokens</div>
      <div className="text-muted-foreground">{formatHeatmapDate(p.date)}</div>
    </div>
  );
}

/** Daily tokens, last 90 days: a single series (one hue), crosshair tooltip, recessive grid. */
export function TrendChart({ data }: { data: Point[] }) {
  return (
    <div className="h-56 w-full" role="img" aria-label="Daily tokens over the last 90 days">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="trendFill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--focus)" stopOpacity={0.25} />
              <stop offset="100%" stopColor="var(--focus)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeWidth={1} />
          <XAxis
            dataKey="date"
            tickLine={false}
            axisLine={{ stroke: "var(--chart-grid)" }}
            tick={{ fill: "var(--chart-axis)", fontSize: 11 }}
            tickFormatter={(d: string) => formatHeatmapDate(d).replace(/, \d{4}$/, "")}
            minTickGap={40}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={48}
            tick={{ fill: "var(--chart-axis)", fontSize: 11 }}
            tickFormatter={(v: number) => formatTokens(v)}
          />
          <Tooltip content={<TooltipBox />} cursor={{ stroke: "var(--chart-axis)", strokeWidth: 1 }} />
          <Area
            type="monotone"
            dataKey="total_tokens"
            stroke="var(--focus)"
            strokeWidth={2}
            fill="url(#trendFill)"
            activeDot={{ r: 4, stroke: "var(--card)", strokeWidth: 2 }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
