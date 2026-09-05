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
          where e."lesson_id" = l."id" and e."verified") as real_shares,
        l."comment_count",
        (select count(*) from "comments" c
          where c."subject_type" = 'lesson' and c."subject_id" = l."id"
            and c."status" in ('visible', 'flagged')
            and c."deleted_at" is null) as real_comments
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
    union all
    -- What a reader can SEE: visible and flagged, not deleted. A count that
    -- included hidden rows would advertise comments nobody can read.
    select "slug", 'comment_count', "comment_count"::int, real_comments::int
      from actual where "comment_count" <> real_comments
    union all
    -- Comment counters, keyed by the comment id rather than a lesson slug —
    -- there is no slug to name, and the id is what a moderator would look up.
    select c."id"::text, 'comment.like_count', c."like_count"::int, r.likes::int
      from "comments" c
      join lateral (
        select
          count(*) filter (where type = 'like') as likes,
          count(*) filter (where type = 'dislike') as dislikes
        from "comment_reactions" where "comment_id" = c."id"
      ) r on true
      where c."like_count" <> r.likes
    union all
    select c."id"::text, 'comment.dislike_count', c."dislike_count"::int, r.dislikes::int
      from "comments" c
      join lateral (
        select
          count(*) filter (where type = 'like') as likes,
          count(*) filter (where type = 'dislike') as dislikes
        from "comment_reactions" where "comment_id" = c."id"
      ) r on true
      where c."dislike_count" <> r.dislikes
    union all
    select c."id"::text, 'comment.reply_count', c."reply_count"::int, r.replies::int
      from "comments" c
      join lateral (
        select count(*) as replies from "comments" child
        where child."parent_id" = c."id"
          and child."status" in ('visible', 'flagged')
          and child."deleted_at" is null
      ) r on true
      where c."reply_count" <> r.replies
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
        where e."lesson_id" = l."id" and e."verified"),
      "comment_count" = (select count(*) from "comments" c
        where c."subject_type" = 'lesson' and c."subject_id" = l."id"
          and c."status" in ('visible', 'flagged') and c."deleted_at" is null)
  `);

  await db.execute(sql`
    update "comments" c set
      "like_count" = (select count(*) from "comment_reactions" r
        where r."comment_id" = c."id" and r."type" = 'like'),
      "dislike_count" = (select count(*) from "comment_reactions" r
        where r."comment_id" = c."id" and r."type" = 'dislike'),
      "reply_count" = (select count(*) from "comments" child
        where child."parent_id" = c."id"
          and child."status" in ('visible', 'flagged')
          and child."deleted_at" is null)
  `);
}
