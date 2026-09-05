import "server-only";
import {
  and,
  asc,
  eq,
  gt,
  gte,
  inArray,
  lte,
  or,
  sql,
  type SQL,
} from "drizzle-orm";

import { getAnalyticsDb } from "@/db/analytics-client";
import { activityEvents } from "@/db/schema/activity";
import { users } from "@/db/schema/auth";
import { examAttempts } from "@/db/schema/attempts";
import { quizzes } from "@/db/schema/content";
import { funnelRows } from "@/lib/activity/funnel";
import { percentage } from "@/lib/exams/score";
import { EXPORT_BATCH_SIZE } from "@/lib/exports/policy";
import { funnelCounts } from "./rollup";

/**
 * The rows behind a CSV download.
 *
 * Everything unbounded here is an **async generator over keyset batches**, not
 * a query returning an array. The distinction is the point of the slice: a
 * hundred thousand events materialised into a JS array is a hundred thousand
 * objects in the server's heap before a single byte reaches the client, and
 * the route would be one large export away from an out-of-memory kill that
 * takes every other request on the instance with it. Yielding batches means
 * the process holds `EXPORT_BATCH_SIZE` rows at a time, whatever the total.
 *
 * Keyset, not OFFSET: an export runs for minutes while writes continue
 * arriving. `offset 50000` re-reads the whole prefix each time — quadratic —
 * and, worse, silently skips or repeats rows when the prefix shifts under it.
 * Paging on a strictly increasing key that the WHERE clause carries forward
 * cannot do either.
 *
 * Filters are the caller's, unchanged. An export that ignored the screen's
 * filters would hand back a different population than the one the operator
 * was looking at — the most dangerous kind of wrong, because it looks right.
 */

export interface EventExportFilters {
  verb?: string;
  group?: string;
  from?: Date;
  to?: Date;
  query?: string;
}

/** A header and the rows under it, so the route never names columns itself. */
export interface ExportShape<TRow> {
  header: string[];
  rows: AsyncGenerator<TRow[]>;
}

/* ---------------------------------------------------------------- events -- */

/**
 * `canSeePii` changes the SELECT, not the formatting.
 *
 * The same rule as the on-screen stream, for the same reason and with more at
 * stake: a file leaves the building. Blanking the columns after fetching them
 * would put personal data in the process, in any log that captures a query
 * result, and one edit away from the file.
 */
export function exportEvents(
  filters: EventExportFilters,
  canSeePii: boolean,
  maxRows: number,
): ExportShape<string[]> {
  const header = [
    "id",
    "created_at",
    "verb",
    "object_type",
    "object_id",
    "actor_id",
    "actor_name",
    "actor_email",
    ...(canSeePii ? ["ip_address", "user_agent"] : []),
    "metadata",
  ];

  async function* rows(): AsyncGenerator<string[][]> {
    const db = getAnalyticsDb();
    let after: string | null = null;
    let written = 0;

    while (written < maxRows) {
      const batch = await db
        .select({
          id: activityEvents.id,
          createdAt: activityEvents.createdAt,
          verb: activityEvents.verb,
          objectType: activityEvents.objectType,
          objectId: activityEvents.objectId,
          actorId: activityEvents.actorId,
          actorName: users.name,
          actorEmail: users.email,
          ipAddress: canSeePii
            ? activityEvents.ipAddress
            : sql<null>`null::text`.as("ip_address"),
          userAgent: canSeePii
            ? activityEvents.userAgent
            : sql<null>`null::text`.as("user_agent"),
          metadata: activityEvents.metadata,
        })
        .from(activityEvents)
        .leftJoin(users, eq(users.id, activityEvents.actorId))
        .where(
          and(
            eventWhere(filters),
            after ? gt(activityEvents.id, after) : undefined,
          ),
        )
        // Ascending by id, which is the keyset. The ids are UUID v7, so this
        // is also chronological — the file reads oldest-first, which is what a
        // spreadsheet of events wants, and it costs no extra index.
        .orderBy(asc(activityEvents.id))
        .limit(Math.min(EXPORT_BATCH_SIZE, maxRows - written));

      if (batch.length === 0) return;

      after = batch[batch.length - 1]!.id;
      written += batch.length;

      yield batch.map((row) => [
        row.id,
        row.createdAt.toISOString(),
        row.verb,
        row.objectType ?? "",
        row.objectId ?? "",
        row.actorId ?? "",
        row.actorName ?? "",
        row.actorEmail ?? "",
        ...(canSeePii ? [row.ipAddress ?? "", row.userAgent ?? ""] : []),
        // Serialised rather than spread into columns: the shape differs per
        // verb, and a column per key would make the header depend on which
        // rows happened to be in the window.
        row.metadata ? JSON.stringify(row.metadata) : "",
      ]);

      if (batch.length < EXPORT_BATCH_SIZE) return;
    }
  }

  return { header, rows: rows() };
}

/** The same clauses the on-screen stream applies, so the file matches the view. */
function eventWhere(filters: EventExportFilters): SQL | undefined {
  const clauses: (SQL | undefined)[] = [];

  if (filters.verb) {
    clauses.push(sql`${activityEvents.verb}::text = ${filters.verb}`);
  }
  if (filters.group) {
    clauses.push(
      sql`${activityEvents.verb}::text like ${`${filters.group}.%`}`,
    );
  }
  if (filters.from) clauses.push(gte(activityEvents.createdAt, filters.from));
  if (filters.to) clauses.push(lte(activityEvents.createdAt, filters.to));
  if (filters.query) {
    const pattern = `%${filters.query}%`;
    clauses.push(
      or(
        sql`${users.email} ilike ${pattern}`,
        sql`${users.name} ilike ${pattern}`,
        sql`${activityEvents.objectId} ilike ${pattern}`,
      ),
    );
  }

  const present = clauses.filter(Boolean) as SQL[];
  return present.length > 0 ? and(...present) : undefined;
}

/* -------------------------------------------------------------- attempts -- */

export interface AttemptExportFilters {
  /** A single quiz, when the download came from that quiz's screen. */
  quizSlug?: string;
}

/**
 * Sittings, with the candidate attached.
 *
 * Name and email are personal data too, but they are not gated the way the
 * event stream's IP is: `exam:export` is a grant to take away exam RESULTS,
 * and a result nobody can attribute to a candidate is not a result. The
 * gating happens at the permission, once, rather than column by column.
 */
export function exportAttempts(
  filters: AttemptExportFilters,
  maxRows: number,
): ExportShape<string[]> {
  const header = [
    "attempt_id",
    "quiz_slug",
    "quiz_title",
    "user_id",
    "user_name",
    "user_email",
    "attempt_number",
    "status",
    "score",
    "max_score",
    "percent",
    "passed",
    "started_at",
    "submitted_at",
    "void_reason",
  ];

  async function* rows(): AsyncGenerator<string[][]> {
    const db = getAnalyticsDb();
    let after: string | null = null;
    let written = 0;

    while (written < maxRows) {
      const batch = await db
        .select({
          id: examAttempts.id,
          quizSlug: quizzes.slug,
          quizTitle: quizzes.title,
          userId: examAttempts.userId,
          userName: users.name,
          userEmail: users.email,
          attemptNumber: examAttempts.attemptNumber,
          status: examAttempts.status,
          score: examAttempts.score,
          maxScore: examAttempts.maxScore,
          passed: examAttempts.passed,
          startedAt: examAttempts.startedAt,
          submittedAt: examAttempts.submittedAt,
          voidReason: examAttempts.voidReason,
        })
        .from(examAttempts)
        .innerJoin(quizzes, eq(quizzes.id, examAttempts.quizId))
        // LEFT: a deleted account must not delete its sittings from the quiz's
        // history, and an export that quietly dropped them would under-report
        // every cohort that has had a leaver.
        .leftJoin(users, eq(users.id, examAttempts.userId))
        .where(
          and(
            filters.quizSlug ? eq(quizzes.slug, filters.quizSlug) : undefined,
            after ? gt(examAttempts.id, after) : undefined,
          ),
        )
        .orderBy(asc(examAttempts.id))
        .limit(Math.min(EXPORT_BATCH_SIZE, maxRows - written));

      if (batch.length === 0) return;

      after = batch[batch.length - 1]!.id;
      written += batch.length;

      yield batch.map((row) => [
        row.id,
        row.quizSlug,
        row.quizTitle,
        row.userId,
        row.userName ?? "",
        row.userEmail ?? "",
        String(row.attemptNumber),
        row.status,
        row.score === null ? "" : String(row.score),
        row.maxScore === null ? "" : String(row.maxScore),
        // Computed the same way the screen computes it, from the same helper.
        // A percentage recomputed differently in the file is a number an
        // operator cannot reconcile with the one they were just shown.
        row.score === null || row.maxScore === null
          ? ""
          : String(percentage(row.score, row.maxScore)),
        row.passed === null ? "" : row.passed ? "true" : "false",
        row.startedAt.toISOString(),
        row.submittedAt ? row.submittedAt.toISOString() : "",
        row.voidReason ?? "",
      ]);

      if (batch.length < EXPORT_BATCH_SIZE) return;
    }
  }

  return { header, rows: rows() };
}

/* ---------------------------------------------------------------- funnel -- */

/**
 * Five rows, and no generator worth the name — but the same shape, so the
 * route has one code path rather than a special case.
 *
 * `not_recorded` is a column rather than a blank: a stage nothing emits reads
 * as zero in a spreadsheet, and "0 people read a lesson" is a claim the data
 * does not support. The file has to be as honest as the screen.
 */
export function exportFunnel(from: Date, to: Date): ExportShape<string[]> {
  const header = [
    "stage",
    "people",
    "not_recorded",
    "conversion_from_previous_percent",
    "drop_off_percent",
    "percent_of_first_stage",
  ];

  async function* rows(): AsyncGenerator<string[][]> {
    const counts = await funnelCounts(from, to);
    yield counts.map((row) => [
      row.key,
      row.notYetRecorded ? "" : String(row.people),
      row.notYetRecorded ? "true" : "false",
      row.conversion === null ? "" : String(row.conversion),
      row.dropOff === null ? "" : String(row.dropOff),
      row.ofFirst === null ? "" : String(row.ofFirst),
    ]);
  }

  return { header, rows: rows() };
}

/** Re-exported so a test can build expected funnel rows without a database. */
export { funnelRows };

/* ------------------------------------------------------------ rate limit -- */

/**
 * When this user last exported, read from the activity stream itself.
 *
 * No second table: every export already records an `admin.exported` event
 * because #19 asks for exports to be audited, and a rate limiter reading the
 * audit record cannot drift from it. The one consequence worth stating is
 * that the limiter inherits the stream's retention — which is six months,
 * far longer than the one-hour window it looks at.
 */
export async function recentExportTimes(
  actorId: string,
  since: Date,
): Promise<Date[]> {
  const rows = await getAnalyticsDb()
    .select({ createdAt: activityEvents.createdAt })
    .from(activityEvents)
    .where(
      and(
        eq(activityEvents.actorId, actorId),
        inArray(activityEvents.verb, ["admin.exported"]),
        gte(activityEvents.createdAt, since),
      ),
    );

  return rows.map((row) => row.createdAt);
}
