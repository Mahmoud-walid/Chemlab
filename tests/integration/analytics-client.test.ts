import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { uuidv7 } from "uuidv7";

import {
  ANALYTICS_POOL_MAX,
  ANALYTICS_STATEMENT_TIMEOUT_MS,
  closeAnalyticsDb,
  createAnalyticsClient,
  getAnalyticsDb,
} from "@/db/analytics-client";
import { connect, seedUrl, type SeedDatabase } from "@/db/seed/connect";

/**
 * The analytics connection budget, against real Postgres.
 *
 * Every claim here is about the DATABASE's behaviour, not about our code
 * calling a setter: `statement_timeout` is enforced by the server, the
 * cancellation arrives as a specific SQLSTATE, and the pool bound is only
 * real if a slow query on it leaves the interactive pool alone. None of that
 * can be shown with a mock, which is the whole reason the criterion exists.
 */

/** Postgres cancels a statement that outruns `statement_timeout` with this. */
const QUERY_CANCELED = "57014";

let url: string;
let interactive: SeedDatabase;
let closeInteractive: () => Promise<void>;

beforeAll(() => {
  const resolved = seedUrl();
  if (!resolved) throw new Error("no database URL");
  url = resolved;
  ({ db: interactive, close: closeInteractive } = connect(url));
});

afterAll(async () => {
  await closeAnalyticsDb();
  await closeInteractive?.();
});

describe("the analytics client", () => {
  it("sets a session statement_timeout on every connection it hands out", async () => {
    const db = getAnalyticsDb();

    // Asked of the server, not of our config object: the point is that the
    // SET actually ran before the caller's first query, which is the thing
    // the `connect` handler is relied on for.
    const result = await db.execute<{ statement_timeout: string }>(
      sql`show statement_timeout`,
    );
    const rows = "rows" in result ? result.rows : result;

    expect(rows[0]?.statement_timeout).toBe(
      `${ANALYTICS_STATEMENT_TIMEOUT_MS / 1000}s`,
    );
  });

  it("kills a slow query rather than letting it run", async () => {
    // A short-timeout client rather than the shipped five seconds: waiting
    // five seconds to watch a timer expire teaches nothing the 300ms version
    // does not, and a suite nobody wants to run proves nothing at all.
    const analytics = createAnalyticsClient(url, { statementTimeoutMs: 300 });

    try {
      const started = Date.now();
      await expect(
        analytics.db.execute(sql`select pg_sleep(5)`),
      ).rejects.toMatchObject({ cause: { code: QUERY_CANCELED } });

      // Killed near the deadline, not merely killed eventually. A generous
      // ceiling — this asserts "the timeout is what ended it", not a latency
      // budget for a shared CI runner.
      expect(Date.now() - started).toBeLessThan(4_000);
    } finally {
      await analytics.close();
    }
  });

  it("leaves a concurrent read on the interactive client untouched", async () => {
    const analytics = createAnalyticsClient(url, {
      statementTimeoutMs: 500,
      max: ANALYTICS_POOL_MAX,
    });

    try {
      // Saturate the analytics pool: as many slow queries as it has
      // connections, plus one more that cannot even get a connection. This is
      // the failure being guarded against — an analytics query storm — and
      // the assertion is that the public read below is unaffected by it.
      const stalled = Array.from({ length: ANALYTICS_POOL_MAX + 1 }, () =>
        analytics.db.execute(sql`select pg_sleep(5)`).then(
          () => "resolved" as const,
          () => "rejected" as const,
        ),
      );

      const started = Date.now();
      const publicRead = await interactive.execute<{ n: number }>(
        sql`select count(*)::int as n from lessons`,
      );
      const elapsed = Date.now() - started;

      const rows = "rows" in publicRead ? publicRead.rows : publicRead;
      expect(rows[0]?.n).toBeGreaterThanOrEqual(0);
      // The interactive pool is a different pool. A saturated analytics pool
      // is not a queue the public site waits in.
      expect(elapsed).toBeLessThan(2_000);

      // And every stalled query ends — none of them is still holding a
      // connection when the suite moves on.
      expect(await Promise.all(stalled)).toEqual(
        Array.from({ length: ANALYTICS_POOL_MAX + 1 }, () => "rejected"),
      );
    } finally {
      await analytics.close();
    }
  });

  it("bounds the pool, so analytics contention stays inside analytics", () => {
    const analytics = createAnalyticsClient(url);
    try {
      expect(analytics.pool.options.max).toBe(ANALYTICS_POOL_MAX);
      expect(ANALYTICS_POOL_MAX).toBeLessThanOrEqual(3);
    } finally {
      void analytics.close();
    }
  });
});

/**
 * The other half of the budget: the dashboards must not be expensive in the
 * first place. A timeout turns a bad query into an error; an index turns it
 * into a query nobody notices.
 *
 * These run EXPLAIN against a table with enough rows, and recent enough
 * statistics, that the planner has a real choice to make. On an empty table
 * it would choose a sequential scan whatever the indexes say, and a test that
 * passes only because the table is empty is a test that will keep passing
 * after the index is dropped.
 */
describe("the dashboard queries' plans", () => {
  const MARKER = `analytics-plan-${uuidv7()}`;

  beforeAll(async () => {
    // Ninety days of history, so "today" is a selective predicate rather than
    // the whole table.
    await interactive.execute(sql`
      insert into activity_events (id, verb, object_type, object_id, actor_id, created_at)
      select
        gen_random_uuid(),
        'lesson.viewed'::activity_verb,
        'lesson'::activity_object_type,
        ${MARKER},
        null,
        now() - (n || ' hours')::interval
      from generate_series(1, 4000) as n
    `);
    await interactive.execute(sql`analyze activity_events`);
  });

  afterAll(async () => {
    await interactive.execute(
      sql`delete from activity_events where object_id = ${MARKER}`,
    );
    await interactive.execute(sql`analyze activity_events`);
  });

  async function planFor(query: ReturnType<typeof sql>): Promise<string> {
    const result = await interactive.execute<{ "QUERY PLAN": string }>(
      sql`explain (costs off) ${query}`,
    );
    const rows = "rows" in result ? result.rows : result;
    return (rows as { "QUERY PLAN": string }[])
      .map((row) => row["QUERY PLAN"])
      .join("\n");
  }

  it("reads today's live count through the verb index, not a scan", async () => {
    // The shape `dailySeries` uses for the current day.
    const plan = await planFor(sql`
      select count(*)::int
      from activity_events
      where verb in ('lesson.viewed')
        and created_at >= date_trunc('day', now())
    `);

    expect(plan).toMatch(/Index|Bitmap/);
    expect(plan).not.toMatch(/Seq Scan on activity_events/);
  });

  it("counts funnel people through the verb index, not a scan", async () => {
    // The shape `funnelCounts` uses per verb stage.
    const plan = await planFor(sql`
      select count(distinct actor_id)::int
      from activity_events
      where verb in ('lesson.viewed')
        and created_at >= now() - interval '1 day'
        and created_at < now()
    `);

    expect(plan).toMatch(/Index|Bitmap/);
    expect(plan).not.toMatch(/Seq Scan on activity_events/);
  });

  it("pages an export through the id index, not a scan", async () => {
    // The shape `exportEvents` uses: keyset on the primary key, bounded by a
    // date range.
    const plan = await planFor(sql`
      select id, created_at, verb
      from activity_events
      where created_at >= now() - interval '2 hours'
      order by id asc
      limit 500
    `);

    expect(plan).not.toMatch(/Seq Scan on activity_events/);
  });
});
