import { sql } from "drizzle-orm";

import type { AnyDatabase } from "@/db/any-database";
import {
  MAX_BATCHES_PER_RUN,
  RETENTION_BATCH_SIZE,
  retentionCutoffs,
  retentionWindowsAreCoherent,
  EVENT_RETENTION_DAYS,
  PII_RETENTION_DAYS,
} from "@/lib/exports/retention";

/**
 * Enforcing the retention windows, in bounded batches.
 *
 * Takes a database handle rather than reaching for `getDb()`, and carries no
 * `server-only`: this runs from a scheduled script outside Next.js, and the
 * integration test drives it against a real table with rows aged by hand. A
 * retention job nobody can run in a test is a retention job nobody has ever
 * seen work.
 *
 * Two passes, in this order:
 *
 * 1. **Delete** events past the event window. Oldest first, `ctid`-selected in
 *    a CTE so each statement touches a bounded set and the lock it holds is
 *    short. A single unbounded DELETE on this table blocks the inserts that
 *    arrive while it runs, and every one of those is somebody's page load.
 *
 * 2. **Anonymise** events past the shorter personal-data window: the row and
 *    its counts stay, `ip_address` and `user_agent` become NULL. This is the
 *    pass that is easy to forget, and forgetting it means keeping IP
 *    addresses for the full six months while believing the window is three.
 *
 * Delete first, deliberately: anything the first pass removes is work the
 * second pass then does not have to do.
 */

export interface RetentionRun {
  deleted: number;
  anonymised: number;
  /** True when a pass hit its batch ceiling and left work for the next run. */
  truncated: boolean;
  cutoffs: { deleteBefore: Date; anonymiseBefore: Date };
}

export interface RetentionOptions {
  now?: Date;
  eventDays?: number;
  piiDays?: number;
  batchSize?: number;
  maxBatches?: number;
  /** Reports without writing. The counts are then what WOULD be affected. */
  dryRun?: boolean;
}

export async function runRetention(
  db: AnyDatabase,
  options: RetentionOptions = {},
): Promise<RetentionRun> {
  const eventDays = options.eventDays ?? EVENT_RETENTION_DAYS;
  const piiDays = options.piiDays ?? PII_RETENTION_DAYS;

  // Checked here rather than trusted, because the failure is silent: with the
  // windows the wrong way round the anonymise pass would find nothing to do
  // and the job would report success every night while enforcing nothing.
  if (!retentionWindowsAreCoherent(eventDays, piiDays)) {
    throw new Error(
      `Incoherent retention windows: events ${eventDays}d, PII ${piiDays}d. ` +
        "Personal data cannot be kept longer than the events carrying it.",
    );
  }

  const cutoffs = retentionCutoffs(options.now ?? new Date(), {
    events: eventDays,
    pii: piiDays,
  });
  const batchSize = options.batchSize ?? RETENTION_BATCH_SIZE;
  const maxBatches = options.maxBatches ?? MAX_BATCHES_PER_RUN;

  if (options.dryRun) {
    const [deleted, anonymised] = await Promise.all([
      countRows(db, sql`created_at < ${cutoffs.deleteBefore}`),
      countRows(
        db,
        sql`created_at < ${cutoffs.anonymiseBefore}
            and created_at >= ${cutoffs.deleteBefore}
            and (ip_address is not null or user_agent is not null)`,
      ),
    ]);
    return { deleted, anonymised, truncated: false, cutoffs };
  }

  let deleted = 0;
  let anonymised = 0;
  let truncated = false;

  for (let batch = 0; batch < maxBatches; batch++) {
    const result = await db.execute(sql`
      delete from activity_events
      where ctid in (
        select ctid from activity_events
        where created_at < ${cutoffs.deleteBefore}
        limit ${batchSize}
      )
    `);
    const rows = result.rowCount ?? 0;
    deleted += rows;
    // Short of the batch means the pass is finished — not "probably", since
    // the LIMIT would have been filled if more matching rows existed.
    if (rows < batchSize) break;
    if (batch === maxBatches - 1) truncated = true;
  }

  for (let batch = 0; batch < maxBatches; batch++) {
    const result = await db.execute(sql`
      update activity_events
      set ip_address = null, user_agent = null
      where ctid in (
        select ctid from activity_events
        where created_at < ${cutoffs.anonymiseBefore}
          -- Only rows that still hold something. Without this the UPDATE
          -- rewrites the same already-blank rows on every run: the LIMIT
          -- always fills, the loop always hits its ceiling, and the job
          -- churns the table forever while reporting work it did not do.
          and (ip_address is not null or user_agent is not null)
        limit ${batchSize}
      )
    `);
    const rows = result.rowCount ?? 0;
    anonymised += rows;
    if (rows < batchSize) break;
    if (batch === maxBatches - 1) truncated = true;
  }

  return { deleted, anonymised, truncated, cutoffs };
}

async function countRows(
  db: AnyDatabase,
  where: ReturnType<typeof sql>,
): Promise<number> {
  const result = await db.execute<{ n: number }>(
    sql`select count(*)::int as n from activity_events where ${where}`,
  );
  const rows = (result as unknown as { rows?: { n: number }[] }).rows;
  return Number(rows?.[0]?.n ?? 0);
}
