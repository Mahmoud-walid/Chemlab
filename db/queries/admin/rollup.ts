import "server-only";
import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";

import { getAnalyticsDb } from "@/db/analytics-client";
import { getDb } from "@/db/client";
import { activityDailyRollup, activityEvents } from "@/db/schema/activity";
import { examAttempts } from "@/db/schema/attempts";
import { quizzes } from "@/db/schema/content";
import {
  FUNNEL_STAGES,
  funnelRows,
  type FunnelRow,
} from "@/lib/activity/funnel";
import type { ActivityVerb } from "@/lib/activity/verbs";

/**
 * The dashboard's read and write paths.
 *
 * The rule that shapes both: **a dashboard must not scan raw events on every
 * load.** `activity_events` grows faster than everything else in this schema,
 * so a chart that counts over it gets slower every day the product is used.
 * Closed days are read from `activity_daily_rollup`; only the current day is
 * queried live, and that window is bounded by definition.
 */

// ── Writing ─────────────────────────────────────────────────────────────────

export interface RollupResult {
  day: string;
  rows: number;
}

/**
 * Recomputes one day, idempotently.
 *
 * `ON CONFLICT DO UPDATE` rather than delete-then-insert: running the same day
 * twice must produce identical rows, and a delete-then-insert leaves the table
 * momentarily missing a day that a dashboard could read in between.
 *
 * The whole day is recomputed rather than incremented, because an increment
 * has to know what it has already counted — and the first time that bookkeeping
 * is wrong, every number after it is wrong with no way to notice.
 */
export async function rollUpDay(day: string): Promise<RollupResult> {
  // The one function in this file that stays on the interactive client, and
  // the reason is the analytics client's timeout. This is a scheduled batch
  // WRITE, not a dashboard read: nobody is waiting on it, it is invoked from
  // a cron script rather than a request, and it aggregates a whole day in one
  // statement. Capping that statement at the dashboards' five seconds would
  // break the job on exactly the days with the most data — the days it
  // matters most. It is also no threat to the pool it shares: it runs once a
  // day from a script process, not once per page view.
  const db = getDb();

  const result = await db.execute(sql`
    insert into ${activityDailyRollup} (
      day, verb, object_type, object_id, event_count, unique_actors, computed_at
    )
    select
      ${day}::date,
      e.verb,
      -- Cast: object_type on activity_events is an ENUM, and the empty string
      -- is not one of its values. Empty string rather than null because a
      -- null in a primary key compares as distinct in Postgres, so nullable
      -- columns here would let the same row insert twice and break the
      -- idempotency this whole design depends on.
      coalesce(e.object_type::text, ''),
      coalesce(e.object_id, ''),
      count(*)::int,
      -- Distinct signed-in people. An anonymous event has no actor and counts
      -- toward the event total but toward nobody's head count, which is the
      -- honest reading of "unique actors".
      count(distinct e.actor_id)::int,
      now()
    from ${activityEvents} e
    where e.created_at >= ${day}::date
      and e.created_at < (${day}::date + interval '1 day')
    group by e.verb, coalesce(e.object_type::text, ''), coalesce(e.object_id, '')
    on conflict (day, verb, object_type, object_id) do update
      set event_count = excluded.event_count,
          unique_actors = excluded.unique_actors,
          computed_at = excluded.computed_at
  `);

  return { day, rows: result.rowCount ?? 0 };
}

/** Every day from `from` up to but excluding today, oldest first. */
export async function rollUpRange(
  from: Date,
  to: Date,
): Promise<RollupResult[]> {
  const results: RollupResult[] = [];
  for (
    let cursor = startOfDay(from);
    cursor < startOfDay(to);
    cursor = addDays(cursor, 1)
  ) {
    results.push(await rollUpDay(isoDay(cursor)));
  }
  return results;
}

// ── Reading ─────────────────────────────────────────────────────────────────

export interface DaySeriesPoint {
  day: string;
  count: number;
}

/**
 * A daily series for one verb, rollups for closed days plus a live count for
 * today.
 *
 * The split is the point. Today has no rollup row — it is not finished — so
 * reading only the rollup would show a dashboard that is always a day stale
 * and looks broken every morning.
 */
export async function dailySeries(
  verbs: ActivityVerb[],
  from: Date,
  to: Date,
  metric: "events" | "actors" = "events",
): Promise<DaySeriesPoint[]> {
  const db = getAnalyticsDb();
  const today = isoDay(startOfDay(new Date()));

  const column =
    metric === "actors"
      ? sql<number>`sum(${activityDailyRollup.uniqueActors})::int`
      : sql<number>`sum(${activityDailyRollup.eventCount})::int`;

  const closed = await db
    .select({
      day: sql<string>`${activityDailyRollup.day}::text`,
      count: column,
    })
    .from(activityDailyRollup)
    .where(
      and(
        inArray(activityDailyRollup.verb, verbs),
        gte(activityDailyRollup.day, isoDay(startOfDay(from))),
        lt(activityDailyRollup.day, today),
      ),
    )
    .groupBy(activityDailyRollup.day)
    .orderBy(activityDailyRollup.day);

  // `sum(unique_actors)` across rows of the same day double-counts a person
  // who did two different things. Accepted for the chart, and named here so
  // nobody reads it as a distinct-people figure: the rollup's grain is
  // (day, verb, object), and collapsing that to true daily uniques needs the
  // raw events. The funnel below, which does need distinct people, reads them.
  const live = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(activityEvents)
    .where(
      and(
        inArray(activityEvents.verb, verbs),
        gte(activityEvents.createdAt, startOfDay(new Date())),
      ),
    );

  const points = closed.map((row) => ({ day: row.day, count: row.count ?? 0 }));
  const todayCount = live[0]?.count ?? 0;
  if (startOfDay(to) >= startOfDay(new Date())) {
    points.push({ day: today, count: todayCount });
  }

  return fillGaps(points, startOfDay(from), startOfDay(to));
}

export interface RankedObject {
  objectId: string;
  title: string;
  count: number;
}

/** Most-viewed lessons, from the rollup's object grain. */
export async function topObjects(
  verbs: ActivityVerb[],
  objectType: string,
  from: Date,
  limit = 10,
): Promise<RankedObject[]> {
  const db = getAnalyticsDb();

  const rows = await db
    .select({
      objectId: activityDailyRollup.objectId,
      count: sql<number>`sum(${activityDailyRollup.eventCount})::int`,
    })
    .from(activityDailyRollup)
    .where(
      and(
        inArray(activityDailyRollup.verb, verbs),
        eq(activityDailyRollup.objectType, objectType),
        gte(activityDailyRollup.day, isoDay(startOfDay(from))),
      ),
    )
    .groupBy(activityDailyRollup.objectId)
    .orderBy(desc(sql`sum(${activityDailyRollup.eventCount})`))
    .limit(limit);

  return rows
    .filter((row) => row.objectId !== "")
    .map((row) => ({ ...row, title: row.objectId }));
}

export interface QuizFunnelPoint {
  slug: string;
  title: string;
  attempts: number;
  passRate: number | null;
}

/** Attempts and pass rate per quiz, straight from the authoritative table. */
export async function quizAttemptSeries(
  from: Date,
): Promise<QuizFunnelPoint[]> {
  const db = getAnalyticsDb();

  return db
    .select({
      slug: quizzes.slug,
      title: quizzes.title,
      attempts: sql<number>`count(*) filter (
        where ${examAttempts.status} in ('submitted','expired')
      )::int`,
      passRate: sql<number | null>`round(100.0 * count(*) filter (
        where ${examAttempts.status} in ('submitted','expired') and ${examAttempts.passed}
      ) / nullif(count(*) filter (
        where ${examAttempts.status} in ('submitted','expired')
      ), 0))::int`,
    })
    .from(quizzes)
    .leftJoin(
      examAttempts,
      and(
        eq(examAttempts.quizId, quizzes.id),
        gte(examAttempts.startedAt, from),
      ),
    )
    .groupBy(quizzes.id, quizzes.slug, quizzes.title, quizzes.position)
    .orderBy(quizzes.position);
}

/**
 * The funnel, counting DISTINCT PEOPLE per stage.
 *
 * Deliberately not from the rollup: its grain is (day, verb, object), so
 * summing `unique_actors` would count somebody who came back on Tuesday twice.
 * A funnel is about people, so this reads the raw events — bounded by the
 * date range, and run on demand rather than on every page of a dashboard.
 */
export async function funnelCounts(from: Date, to: Date): Promise<FunnelRow[]> {
  const db = getAnalyticsDb();
  const counts: Record<string, number> = {};

  for (const stage of FUNNEL_STAGES) {
    if (stage.source.kind === "verb") {
      const [row] = await db
        .select({
          people: sql<number>`count(distinct ${activityEvents.actorId})::int`,
        })
        .from(activityEvents)
        .where(
          and(
            inArray(activityEvents.verb, stage.source.verbs),
            gte(activityEvents.createdAt, from),
            lt(activityEvents.createdAt, to),
          ),
        );
      counts[stage.key] = row?.people ?? 0;
      continue;
    }

    const status = stage.source.status;
    const clauses = [
      gte(examAttempts.startedAt, from),
      lt(examAttempts.startedAt, to),
    ];
    if (status === "finished") {
      clauses.push(inArray(examAttempts.status, ["submitted", "expired"]));
    }
    if (status === "passed") {
      clauses.push(
        inArray(examAttempts.status, ["submitted", "expired"]),
        eq(examAttempts.passed, true),
      );
    }

    const [row] = await db
      .select({
        people: sql<number>`count(distinct ${examAttempts.userId})::int`,
      })
      .from(examAttempts)
      .where(and(...clauses));
    counts[stage.key] = row?.people ?? 0;
  }

  return funnelRows(counts);
}

// ── Dates ───────────────────────────────────────────────────────────────────

export function startOfDay(value: Date): Date {
  // UTC throughout. A rollup keyed on the server's local day would move every
  // number when a deployment region changes, and half the rows would be
  // attributed to the wrong day for the hours around midnight.
  return new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
  );
}

export function addDays(value: Date, days: number): Date {
  return new Date(value.getTime() + days * 86_400_000);
}

export function isoDay(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/**
 * A day with no events is a zero, not a missing point.
 *
 * A line chart that skips empty days draws a straight line across a quiet
 * week and reads as steady traffic.
 */
function fillGaps(
  points: DaySeriesPoint[],
  from: Date,
  to: Date,
): DaySeriesPoint[] {
  const byDay = new Map(points.map((point) => [point.day, point.count]));
  const filled: DaySeriesPoint[] = [];
  for (let cursor = from; cursor <= to; cursor = addDays(cursor, 1)) {
    const day = isoDay(cursor);
    filled.push({ day, count: byDay.get(day) ?? 0 });
  }
  return filled;
}
