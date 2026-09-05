/**
 * How long activity data is kept, expressed once.
 *
 * #19 asks for two different retentions, and the difference is the whole
 * point. The EVENT — "somebody submitted an exam at 14:02" — is what the
 * dashboards are built on and is kept for six months. The PERSONAL columns
 * attached to it — IP address, user agent — are kept for three, because they
 * answer a narrower question ("was this account shared?") that stops being
 * askable long before the aggregate stops being useful.
 *
 * So the older half of the retained window keeps its counts and loses its
 * personal data, rather than the data being kept in full until it is deleted
 * in full. Deleting a row and blanking two of its columns are two jobs on one
 * table, and running only the first would keep IP addresses for six months.
 *
 * Pure: the cutoffs are arithmetic on a clock the caller supplies, so a test
 * can stand at any date rather than waiting six months.
 */

export const EVENT_RETENTION_DAYS = 180;
export const PII_RETENTION_DAYS = 90;

/**
 * Rows touched per statement.
 *
 * A single `delete from activity_events where created_at < ...` on a table
 * with a year of history takes a lock long enough to block the writes that
 * arrive while it runs — and every one of those writes is somebody's page
 * loading. Batching keeps each statement short; the job simply repeats until
 * a batch comes back short of the limit.
 */
export const RETENTION_BATCH_SIZE = 5_000;

/**
 * A ceiling on batches per run, so a job pointed at years of backlog finishes
 * its window and exits rather than running until something kills it. What it
 * does not finish, the next run continues — the work is idempotent by
 * construction, since each batch is chosen by age.
 */
export const MAX_BATCHES_PER_RUN = 200;

export interface RetentionCutoffs {
  /** Events older than this are deleted outright. */
  deleteBefore: Date;
  /** Events older than this keep their counts and lose their personal columns. */
  anonymiseBefore: Date;
}

export function retentionCutoffs(
  now: Date,
  days: { events?: number; pii?: number } = {},
): RetentionCutoffs {
  return {
    deleteBefore: daysBefore(now, days.events ?? EVENT_RETENTION_DAYS),
    anonymiseBefore: daysBefore(now, days.pii ?? PII_RETENTION_DAYS),
  };
}

function daysBefore(now: Date, days: number): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

/**
 * The invariant the two windows have to satisfy.
 *
 * If PII were kept LONGER than the events themselves, the anonymise pass
 * would never run on anything — every row old enough for it would already be
 * deleted — and the shorter window would look enforced while doing nothing.
 * The job asserts this at startup rather than trusting two constants to stay
 * in the right order through a future edit.
 */
export function retentionWindowsAreCoherent(
  eventDays: number,
  piiDays: number,
): boolean {
  return piiDays > 0 && eventDays > 0 && piiDays <= eventDays;
}
