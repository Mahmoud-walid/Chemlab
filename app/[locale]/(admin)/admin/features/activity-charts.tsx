"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from "recharts";

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

export interface SeriesPoint {
  day: string;
  count: number;
}

export interface QuizPoint {
  title: string;
  attempts: number;
  passRate: number | null;
}

/**
 * The dashboard's charts.
 *
 * Every one of them reads `activity_daily_rollup` for closed days and a single
 * bounded query for today — never the raw event table, which out-grows
 * everything else in the schema and would make the dashboard slower every day
 * the product is used.
 *
 * Each chart is paired with the same numbers in text. A chart is a shape, and
 * a shape is not readable by a screen reader; the `<details>` underneath is
 * not a fallback but the same information in the form some people need.
 */

const AXIS = {
  tickLine: false,
  axisLine: false,
  fontSize: 11,
} as const;

/** `2026-03-01` → `Mar 1`, without pulling a date library into the bundle. */
function shortDay(day: string): string {
  const [, month, date] = day.split("-");
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${months[Number(month) - 1] ?? month} ${Number(date)}`;
}

export function DailyAreaChart({
  points,
  label,
  summaryLabel,
}: {
  points: SeriesPoint[];
  label: string;
  summaryLabel: string;
}) {
  const config = {
    count: { label, color: "var(--chart-1)" },
  } satisfies ChartConfig;
  const data = points.map((point) => ({
    ...point,
    short: shortDay(point.day),
  }));

  return (
    <div className="space-y-2">
      <ChartContainer config={config} className="h-48 w-full">
        <AreaChart data={data} accessibilityLayer>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="short" tickMargin={8} {...AXIS} />
          <YAxis allowDecimals={false} width={28} {...AXIS} />
          <ChartTooltip content={<ChartTooltipContent />} />
          <Area
            dataKey="count"
            type="monotone"
            fill="var(--color-count)"
            fillOpacity={0.2}
            stroke="var(--color-count)"
          />
        </AreaChart>
      </ChartContainer>
      <NumbersBehind
        label={summaryLabel}
        rows={data.map((point) => [point.short, String(point.count)])}
      />
    </div>
  );
}

export function DailyLineChart({
  points,
  label,
  summaryLabel,
}: {
  points: SeriesPoint[];
  label: string;
  summaryLabel: string;
}) {
  const config = {
    count: { label, color: "var(--chart-2)" },
  } satisfies ChartConfig;
  const data = points.map((point) => ({
    ...point,
    short: shortDay(point.day),
  }));

  return (
    <div className="space-y-2">
      <ChartContainer config={config} className="h-48 w-full">
        <LineChart data={data} accessibilityLayer>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="short" tickMargin={8} {...AXIS} />
          <YAxis allowDecimals={false} width={28} {...AXIS} />
          <ChartTooltip content={<ChartTooltipContent />} />
          <Line
            dataKey="count"
            type="monotone"
            stroke="var(--color-count)"
            dot={false}
            strokeWidth={2}
          />
        </LineChart>
      </ChartContainer>
      <NumbersBehind
        label={summaryLabel}
        rows={data.map((point) => [point.short, String(point.count)])}
      />
    </div>
  );
}

export function QuizAttemptsChart({
  points,
  attemptsLabel,
  summaryLabel,
  passRateLabel,
}: {
  points: QuizPoint[];
  attemptsLabel: string;
  passRateLabel: string;
  summaryLabel: string;
}) {
  const config = {
    attempts: { label: attemptsLabel, color: "var(--chart-3)" },
  } satisfies ChartConfig;

  return (
    <div className="space-y-2">
      <ChartContainer config={config} className="h-56 w-full">
        <BarChart data={points} accessibilityLayer>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="title" tickMargin={8} interval={0} {...AXIS} />
          <YAxis allowDecimals={false} width={28} {...AXIS} />
          <ChartTooltip content={<ChartTooltipContent />} />
          <Bar dataKey="attempts" fill="var(--color-attempts)" radius={4} />
        </BarChart>
      </ChartContainer>
      <NumbersBehind
        label={summaryLabel}
        rows={points.map((point) => [
          point.title,
          // The pass rate is deliberately in the text rather than a second
          // axis: two axes on one chart is where a reader starts guessing
          // which line belongs to which scale.
          point.passRate === null
            ? String(point.attempts)
            : `${point.attempts} · ${passRateLabel} ${point.passRate}%`,
        ])}
      />
    </div>
  );
}

/** The same numbers, in text, for anyone the chart does not serve. */
function NumbersBehind({
  label,
  rows,
}: {
  label: string;
  rows: [string, string][];
}) {
  return (
    <details className="text-xs text-muted-foreground">
      <summary className="cursor-pointer">{label}</summary>
      <ul className="mt-1 space-y-0.5">
        {rows.map(([name, value]) => (
          <li key={name}>
            {name}
            {": "}
            {value}
          </li>
        ))}
      </ul>
    </details>
  );
}
