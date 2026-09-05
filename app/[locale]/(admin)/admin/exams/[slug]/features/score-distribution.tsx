"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

export interface Bucket {
  from: number;
  count: number;
}

/**
 * How the marks fell.
 *
 * A histogram rather than a single average, because the two answer different
 * questions: an average of 60% is the same number whether everybody scored 60
 * or half the class scored 20 and half scored 100, and only the second is a
 * problem with the quiz.
 *
 * Ten fixed buckets, always all ten — an empty band is information ("nobody
 * scored between 40 and 50"), so it renders as a gap rather than being
 * dropped and closing the axis up.
 *
 * The bars carry a text alternative below rather than only in a tooltip: a
 * chart nobody can read with a screen reader is decoration, and the numbers
 * here are small enough to state outright.
 */
export function ScoreDistribution({
  buckets,
  labels,
}: {
  buckets: Bucket[];
  labels: { attempts: string; band: string; empty: string; summary: string };
}) {
  const total = buckets.reduce((sum, bucket) => sum + bucket.count, 0);

  if (total === 0) {
    return <p className="text-sm text-muted-foreground">{labels.empty}</p>;
  }

  const config = {
    count: { label: labels.attempts, color: "var(--chart-1)" },
  } satisfies ChartConfig;

  const data = buckets.map((bucket) => ({
    band: `${bucket.from}–${bucket.from === 90 ? 100 : bucket.from + 9}`,
    count: bucket.count,
  }));

  return (
    <div className="space-y-2">
      <ChartContainer config={config} className="h-56 w-full">
        <BarChart data={data} accessibilityLayer>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="band"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            fontSize={11}
          />
          <YAxis
            allowDecimals={false}
            tickLine={false}
            axisLine={false}
            width={28}
            fontSize={11}
          />
          <ChartTooltip content={<ChartTooltipContent />} />
          <Bar dataKey="count" fill="var(--color-count)" radius={4} />
        </BarChart>
      </ChartContainer>

      {/* The same data, readable without the chart. */}
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer">{labels.summary}</summary>
        <ul className="mt-1 space-y-0.5">
          {data.map((row) => (
            <li key={row.band}>
              {labels.band.replace("{band}", row.band)}: {row.count}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
