import { sql } from "drizzle-orm";

import type { AnyDatabase } from "@/db/any-database";

/**
 * Recomputing the denormalised counters from their source tables.
 *
 * The counters are maintained by triggers, which is what makes them correct in
 * the same transaction as the row and correct under a cascade delete. What a
 * trigger cannot do is tell you it has been correct: a migration that dropped
 * one, a bulk load with `session_replication_role = replica`, a hand-edited
 * row — any of those leaves a number that looks fine and is wrong.
 *
 * So this exists, it is run in CI against a seeded database, and it can be run
 * by hand in production. Reporting drift is the point; fixing it is optional
 * and off by default, because a counter that silently repairs itself hides the
 * fact that something bypassed a trigger.
 *
 * No `server-only`: this runs from a script outside Next.js and is driven
 * directly by the integration tests.
 */

export interface CounterDrift {
  slug: string;
  column: string;
  stored: number;
  actual: number;
}

export async function findCounterDrift(
  db: AnyDatabase,
): Promise<CounterDrift[]> {
  const result = await db.execute<{
    slug: string;
    column: string;
    stored: number;
    actual: number;
  }>(sql`
    with actual as (
      select
        l."id",
        l."slug",
        l."like_count",
        l."save_count",
        l."share_count",
        (select count(*) from "lesson_likes" k where k."lesson_id" = l."id") as real_likes,
        (select count(*) from "lesson_saves" s where s."lesson_id" = l."id") as real_saves,
        (select count(*) from "share_events" e
          where e."lesson_id" = l."id" and e."verified") as real_shares
      from "lessons" l
    )
    select "slug", 'like_count' as "column", "like_count"::int as stored, real_likes::int as actual
      from actual where "like_count" <> real_likes
    union all
    select "slug", 'save_count', "save_count"::int, real_saves::int
      from actual where "save_count" <> real_saves
    union all
    select "slug", 'share_count', "share_count"::int, real_shares::int
      from actual where "share_count" <> real_shares
    order by 1, 2
  `);

  const rows = (result as unknown as { rows?: CounterDrift[] }).rows ?? [];
  return rows.map((row) => ({
    slug: row.slug,
    column: row.column,
    stored: Number(row.stored),
    actual: Number(row.actual),
  }));
}

/** Repairs every counter from source. Only ever called deliberately. */
export async function repairCounters(db: AnyDatabase): Promise<void> {
  await db.execute(sql`
    update "lessons" l set
      "like_count" = (select count(*) from "lesson_likes" k where k."lesson_id" = l."id"),
      "save_count" = (select count(*) from "lesson_saves" s where s."lesson_id" = l."id"),
      "share_count" = (select count(*) from "share_events" e
        where e."lesson_id" = l."id" and e."verified")
  `);
}
