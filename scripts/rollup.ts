import "@/lib/load-env";
import { connect, seedUrl } from "@/db/seed/connect";
import { sql } from "drizzle-orm";

/**
 * Recomputes the activity rollups.
 *
 * Run for yesterday by default — the day that has just closed — or for a range
 * with `--from` and `--to`. Re-running a day is safe and produces identical
 * rows, which is what makes a backfill something you can do twice without
 * thinking about it.
 *
 *   pnpm rollup                       # yesterday
 *   pnpm rollup --from 2026-01-01     # that day up to yesterday
 *   pnpm rollup --from 2026-01-01 --to 2026-02-01
 *
 * Where it runs is the owner's call and is recorded in docs/ACTIVITY.md: a
 * cron on the host, a scheduled GitHub Action, or by hand after a backfill.
 * The dashboards read today live, so a missed run costs history rather than
 * the current view.
 */

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

function isoDay(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function startOfUtcDay(value: Date): Date {
  return new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
  );
}

async function main() {
  const url = seedUrl();
  if (!url) {
    console.error(
      "No database URL. Set DATABASE_URL_UNPOOLED or DATABASE_URL.",
    );
    process.exit(1);
  }

  const today = startOfUtcDay(new Date());
  const yesterday = new Date(today.getTime() - 86_400_000);

  const from = arg("from") ? new Date(`${arg("from")}T00:00:00Z`) : yesterday;
  // Exclusive, and never past yesterday: today is not a closed day, and a
  // rollup row for it would be wrong the moment anybody does anything.
  const to = arg("to") ? new Date(`${arg("to")}T00:00:00Z`) : today;

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    console.error("Dates must be YYYY-MM-DD.");
    process.exit(1);
  }

  const { db, close } = connect(url);
  let days = 0;
  let rows = 0;

  try {
    for (
      let cursor = startOfUtcDay(from);
      cursor < startOfUtcDay(to) && cursor < today;
      cursor = new Date(cursor.getTime() + 86_400_000)
    ) {
      const day = isoDay(cursor);
      const result = await db.execute(sql`
        insert into activity_daily_rollup (
          day, verb, object_type, object_id, event_count, unique_actors, computed_at
        )
        select
          ${day}::date,
          e.verb,
          coalesce(e.object_type::text, ''),
          coalesce(e.object_id, ''),
          count(*)::int,
          count(distinct e.actor_id)::int,
          now()
        from activity_events e
        where e.created_at >= ${day}::date
          and e.created_at < (${day}::date + interval '1 day')
        group by e.verb, coalesce(e.object_type::text, ''), coalesce(e.object_id, '')
        on conflict (day, verb, object_type, object_id) do update
          set event_count = excluded.event_count,
              unique_actors = excluded.unique_actors,
              computed_at = excluded.computed_at
      `);
      days += 1;
      rows += result.rowCount ?? 0;
    }

    console.log(`rollup: ${days} day(s), ${rows} row(s) written`);
  } finally {
    await close();
  }
}

void main();
