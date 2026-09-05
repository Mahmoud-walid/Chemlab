import { and, desc, eq } from "drizzle-orm";

import type { AnyDatabase } from "@/db/any-database";
import { ciNotificationPreferences, ciRuns } from "@/db/schema/ci";
import type { CiNotifyPayload, CiOutcome } from "@/lib/ci/payload";
import {
  DEFAULT_CI_PREFERENCES,
  type CiPreferences,
  type SuppressionReason,
} from "@/lib/ci/policy";

/**
 * Reading and writing CI runs.
 *
 * Takes a database handle rather than reaching for `getDb()`, so the
 * integration tests can drive the whole path against real rows — the
 * "back to green" rule is a statement about what is IN the table, and a mock
 * would only ever confirm the mock.
 */

/**
 * The last outcome recorded for a branch, before this run.
 *
 * Null when nothing has been recorded, which the policy treats as "no red to
 * recover from" rather than as a recovery — otherwise every repository
 * announces itself once, for no reason.
 */
export async function previousOutcome(
  db: AnyDatabase,
  repository: string,
  branch: string,
  job: string,
): Promise<CiOutcome | null> {
  const [row] = await db
    .select({ outcome: ciRuns.outcome })
    .from(ciRuns)
    .where(
      and(
        eq(ciRuns.repository, repository),
        eq(ciRuns.branch, branch),
        // Per job: `e2e` going red does not mean `verify` did, and a recovery
        // is a statement about one of them at a time.
        eq(ciRuns.job, job),
      ),
    )
    .orderBy(desc(ciRuns.createdAt))
    .limit(1);

  return row?.outcome ?? null;
}

export interface RecordRunResult {
  /** False when this exact run was already recorded — a GitHub retry, or a
   * re-delivery. The caller sends nothing in that case. */
  inserted: boolean;
}

/**
 * Records the run, idempotently.
 *
 * `onConflictDoNothing` against the unique index rather than a check-then-
 * insert: two retries arriving together would both see no row and both
 * insert, and the reader would get the same failure twice. The database is
 * the only place that race can be settled.
 */
export async function recordRun(
  db: AnyDatabase,
  payload: CiNotifyPayload,
  decision: {
    notified: boolean;
    suppressionReason: SuppressionReason | null;
    pushesQueued: number;
  },
): Promise<RecordRunResult> {
  const inserted = await db
    .insert(ciRuns)
    .values({
      repository: payload.repository,
      branch: payload.branch,
      job: payload.job,
      commitSha: payload.commitSha,
      commitMessage: payload.commitMessage,
      outcome: payload.outcome,
      failedJobs: payload.failedJobs,
      actor: payload.actor,
      runUrl: payload.runUrl,
      pullRequestNumber: payload.pullRequestNumber ?? null,
      durationSeconds: payload.durationSeconds ?? null,
      notified: decision.notified,
      suppressionReason: decision.suppressionReason,
      pushesQueued: decision.pushesQueued,
    })
    // No `target`: the unique index is the only constraint this insert can
    // violate, and naming it here would have to restate the index's column
    // list — a second copy that can drift from the migration.
    // `returning()` with no projection: the two Drizzle drivers this handle
    // can be disagree on the typed-projection overload, and all this needs to
    // know is whether a row was written.
    .onConflictDoNothing()
    .returning();

  return { inserted: inserted.length > 0 };
}

/** Whether this exact run attempt has already been recorded. */
export async function alreadyRecorded(
  db: AnyDatabase,
  repository: string,
  runUrl: string,
  job: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: ciRuns.id })
    .from(ciRuns)
    .where(
      and(
        eq(ciRuns.repository, repository),
        eq(ciRuns.runUrl, runUrl),
        eq(ciRuns.job, job),
      ),
    )
    .limit(1);

  return row !== undefined;
}

export interface CiRecipient {
  userId: string;
  preferences: CiPreferences;
}

/**
 * Everybody who has opted in.
 *
 * Only rows with `enabled` — an absent row means never, and asking the
 * database for the absent ones would return every user on the platform.
 */
export async function optedInRecipients(
  db: AnyDatabase,
): Promise<CiRecipient[]> {
  const rows = await db
    .select()
    .from(ciNotificationPreferences)
    .where(eq(ciNotificationPreferences.enabled, true));

  return rows.map((row) => ({
    userId: row.userId,
    preferences: {
      enabled: row.enabled,
      branches: row.branches,
      notifyOnFailure: row.notifyOnFailure,
      successPolicy: row.successPolicy,
      notifyOnCancelled: row.notifyOnCancelled,
    },
  }));
}

/** One person's settings, defaulted when they have no row. */
export async function ciPreferencesFor(
  db: AnyDatabase,
  userId: string,
): Promise<CiPreferences> {
  const [row] = await db
    .select()
    .from(ciNotificationPreferences)
    .where(eq(ciNotificationPreferences.userId, userId));

  if (!row) return DEFAULT_CI_PREFERENCES;

  return {
    enabled: row.enabled,
    branches: row.branches,
    notifyOnFailure: row.notifyOnFailure,
    successPolicy: row.successPolicy,
    notifyOnCancelled: row.notifyOnCancelled,
  };
}

/** Writes the fields a patch carried, creating the row if there is none. */
export async function saveCiPreferences(
  db: AnyDatabase,
  userId: string,
  update: Partial<CiPreferences>,
): Promise<CiPreferences> {
  await db
    .insert(ciNotificationPreferences)
    .values({ userId, ...update, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: ciNotificationPreferences.userId,
      set: { ...update, updatedAt: new Date() },
    });

  return ciPreferencesFor(db, userId);
}

/** Recent runs for a branch, newest first — for a future dashboard and for
 * answering "when did this start failing?" with SQL rather than a scroll
 * through the Actions tab. */
export async function recentRuns(
  db: AnyDatabase,
  repository: string,
  limit = 20,
) {
  return db
    .select()
    .from(ciRuns)
    .where(eq(ciRuns.repository, repository))
    .orderBy(desc(ciRuns.createdAt))
    .limit(limit);
}
