import "server-only";
import { and, asc, desc, eq, ilike, inArray, lt, or, sql } from "drizzle-orm";

import { getDb } from "@/db/client";
import { activityEvents } from "@/db/schema/activity";
import { profiles, sessions, users } from "@/db/schema/auth";
import { examAttempts } from "@/db/schema/attempts";
import { quizzes } from "@/db/schema/content";
import { roles, userRoles } from "@/db/schema/rbac";
import { percentage } from "@/lib/exams/score";
import type { ActivityVerb } from "@/lib/activity/verbs";
import {
  parseListParams,
  type ListParams,
  type ListParamsSpec,
} from "./list-params";

/**
 * People, for the admin panel.
 *
 * The per-user forensic view #19 asks for: what has this person done, and
 * when. It reads the activity spine rather than counters kept on the user row
 * — counters answer only the questions somebody thought of in advance, and
 * they drift the first time a write path forgets to increment one.
 */

export const USER_LIST_SPEC = {
  sortable: ["createdAt", "name", "email"],
  defaultSort: "createdAt",
  defaultDirection: "desc",
} as const satisfies ListParamsSpec<"createdAt" | "name" | "email">;

export type UserSort = (typeof USER_LIST_SPEC)["sortable"][number];

export interface UserRow {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  createdAt: Date;
  avatarUrl: string | null;
  roleKeys: string[];
  /** Newest session, which is as close to "last seen" as sessions can say. */
  lastSeenAt: Date | null;
}

export interface UserListPage {
  rows: UserRow[];
  total: number;
  pages: number;
}

export async function listUsers(
  params: ListParams<UserSort>,
  query: string,
): Promise<UserListPage> {
  const db = getDb();

  const search = query.trim();
  const where = search
    ? or(ilike(users.name, `%${search}%`), ilike(users.email, `%${search}%`))
    : undefined;

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(users)
    .where(where);

  const column = {
    createdAt: users.createdAt,
    name: users.name,
    email: users.email,
  }[params.sort];

  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      emailVerified: users.emailVerified,
      createdAt: users.createdAt,
      avatarUrl: profiles.avatarUrl,
      // Aggregated in SQL rather than by a second round trip per user: the
      // list is 25 rows, and 25 extra queries to render a column of badges is
      // how a page ends up taking a second to draw.
      roleKeys: sql<string[]>`coalesce(
        array(
          select r.key from ${userRoles} ur
          join ${roles} r on r.id = ur.role_id
          where ur.user_id = ${users.id}
          order by r.key
        ), '{}'
      )`,
      lastSeenAt: sql<Date | null>`(
        select max(s.created_at) from ${sessions} s where s.user_id = ${users.id}
      )`,
    })
    .from(users)
    .leftJoin(profiles, eq(profiles.userId, users.id))
    .where(where)
    .orderBy(params.direction === "asc" ? asc(column) : desc(column))
    .limit(params.pageSize)
    .offset((params.page - 1) * params.pageSize);

  return {
    rows,
    total,
    pages: Math.max(1, Math.ceil(total / params.pageSize)),
  };
}

// ── One person ──────────────────────────────────────────────────────────────

export interface UserCounts {
  lessonsViewed: number;
  lessonsCompleted: number;
  comments: number;
  likes: number;
  examsTaken: number;
  examsPassed: number;
}

export interface UserQuizResult {
  quizSlug: string;
  quizTitle: string;
  attempts: number;
  bestPercent: number | null;
  latestPercent: number | null;
  latestAt: Date | null;
  passed: boolean;
}

export interface UserDetail {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  createdAt: Date;
  avatarUrl: string | null;
  bio: string | null;
  locale: string | null;
  roleKeys: string[];
  lastSeenAt: Date | null;
  counts: UserCounts;
  quizzes: UserQuizResult[];
}

/** Which verbs each headline count is made of, named once. */
const COUNTED: Record<
  keyof Omit<UserCounts, "examsTaken" | "examsPassed">,
  ActivityVerb[]
> = {
  lessonsViewed: ["lesson.viewed"],
  lessonsCompleted: ["lesson.completed"],
  comments: ["comment.posted"],
  likes: ["lesson.liked", "comment.liked"],
};

export async function getUserDetail(
  userId: string,
): Promise<UserDetail | null> {
  const db = getDb();

  const [row] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      emailVerified: users.emailVerified,
      createdAt: users.createdAt,
      avatarUrl: profiles.avatarUrl,
      bio: profiles.bio,
      locale: profiles.locale,
      roleKeys: sql<string[]>`coalesce(
        array(
          select r.key from ${userRoles} ur
          join ${roles} r on r.id = ur.role_id
          where ur.user_id = ${users.id}
          order by r.key
        ), '{}'
      )`,
      lastSeenAt: sql<Date | null>`(
        select max(s.created_at) from ${sessions} s where s.user_id = ${users.id}
      )`,
    })
    .from(users)
    .leftJoin(profiles, eq(profiles.userId, users.id))
    .where(eq(users.id, userId));

  if (!row) return null;

  // One grouped pass over this person's events rather than a query per count.
  const verbCounts = await db
    .select({
      verb: activityEvents.verb,
      count: sql<number>`count(*)::int`,
    })
    .from(activityEvents)
    .where(eq(activityEvents.actorId, userId))
    .groupBy(activityEvents.verb);

  const byVerb = new Map(verbCounts.map((entry) => [entry.verb, entry.count]));
  const sum = (verbs: ActivityVerb[]) =>
    verbs.reduce((total, verb) => total + (byVerb.get(verb) ?? 0), 0);

  // Exams are counted from `exam_attempts`, not from `exam.submitted` events.
  // The attempt row is the authoritative record — an event stream can lose a
  // fire-and-forget write, and a score reconstructed from one would be a
  // second answer to a question that already has an authoritative one.
  const attemptRows = await db
    .select({
      quizSlug: quizzes.slug,
      quizTitle: quizzes.title,
      attempts: sql<number>`count(*)::int`,
      bestPercent: sql<number | null>`max(
        case when ${examAttempts.status} in ('submitted','expired')
             and coalesce(${examAttempts.maxScore},0) > 0
        then round(${examAttempts.score}::numeric * 100 / ${examAttempts.maxScore})
        end
      )::int`,
      everPassed: sql<boolean>`bool_or(
        ${examAttempts.status} in ('submitted','expired') and ${examAttempts.passed}
      )`,
      latestAt: sql<Date | null>`max(${examAttempts.submittedAt})`,
    })
    .from(examAttempts)
    .innerJoin(quizzes, eq(quizzes.id, examAttempts.quizId))
    // Voided sittings are excluded from the headline record on purpose: a
    // struck-out attempt should not be somebody's best score.
    .where(
      and(
        eq(examAttempts.userId, userId),
        inArray(examAttempts.status, ["submitted", "expired"]),
      ),
    )
    .groupBy(quizzes.id, quizzes.slug, quizzes.title)
    .orderBy(desc(sql`max(${examAttempts.submittedAt})`));

  const latestRows = await db
    .select({
      quizSlug: quizzes.slug,
      score: examAttempts.score,
      maxScore: examAttempts.maxScore,
      submittedAt: examAttempts.submittedAt,
    })
    .from(examAttempts)
    .innerJoin(quizzes, eq(quizzes.id, examAttempts.quizId))
    .where(
      and(
        eq(examAttempts.userId, userId),
        inArray(examAttempts.status, ["submitted", "expired"]),
      ),
    )
    .orderBy(desc(examAttempts.submittedAt));

  const latestBySlug = new Map<string, number>();
  for (const entry of latestRows) {
    if (!latestBySlug.has(entry.quizSlug)) {
      latestBySlug.set(
        entry.quizSlug,
        percentage(entry.score ?? 0, entry.maxScore ?? 0),
      );
    }
  }

  return {
    ...row,
    counts: {
      lessonsViewed: sum(COUNTED.lessonsViewed),
      lessonsCompleted: sum(COUNTED.lessonsCompleted),
      comments: sum(COUNTED.comments),
      likes: sum(COUNTED.likes),
      examsTaken: attemptRows.reduce(
        (total, entry) => total + entry.attempts,
        0,
      ),
      examsPassed: attemptRows.filter((entry) => entry.everPassed).length,
    },
    quizzes: attemptRows.map((entry) => ({
      quizSlug: entry.quizSlug,
      quizTitle: entry.quizTitle,
      attempts: entry.attempts,
      bestPercent: entry.bestPercent,
      latestPercent: latestBySlug.get(entry.quizSlug) ?? null,
      latestAt: entry.latestAt,
      passed: entry.everPassed,
    })),
  };
}

// ── The timeline ────────────────────────────────────────────────────────────

export interface TimelineEntry {
  id: string;
  verb: ActivityVerb;
  objectType: string | null;
  objectId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

export interface TimelinePage {
  entries: TimelineEntry[];
  /** Opaque; feed it back as `cursor` for the next page. Null at the end. */
  nextCursor: string | null;
}

/**
 * Keyset pagination, not OFFSET.
 *
 * `activity_events` is append-only and grows at the head, so an OFFSET page
 * two is a different set of rows every time somebody does anything: rows shift
 * down past the boundary and get skipped, and the deeper the page the more
 * work Postgres does to throw rows away. A keyset on `(created_at, id)` reads
 * an index range instead, and returns the same page whatever arrives after it.
 *
 * `id` breaks the tie because two events in the same millisecond are ordinary
 * — a submit writes several — and a cursor on the timestamp alone would either
 * repeat them or skip them.
 */
export async function getUserTimeline(
  userId: string,
  options: { limit?: number; cursor?: string } = {},
): Promise<TimelinePage> {
  const db = getDb();
  const limit = Math.min(100, Math.max(1, options.limit ?? 25));

  const after = parseCursor(options.cursor);
  const where = after
    ? and(
        eq(activityEvents.actorId, userId),
        or(
          lt(activityEvents.createdAt, after.createdAt),
          and(
            eq(activityEvents.createdAt, after.createdAt),
            lt(activityEvents.id, after.id),
          ),
        ),
      )
    : eq(activityEvents.actorId, userId);

  const rows = await db
    .select({
      id: activityEvents.id,
      verb: activityEvents.verb,
      objectType: activityEvents.objectType,
      objectId: activityEvents.objectId,
      metadata: activityEvents.metadata,
      createdAt: activityEvents.createdAt,
      // NOT `ipAddress`, NOT `userAgent`. This timeline is shown to any reader
      // with `activity:read`; the PII columns need `activity:read_pii` and are
      // served by db/queries/admin/activity.ts, which gates them in the SELECT.
    })
    .from(activityEvents)
    // One extra row, to learn whether there is a next page without counting.
    .limit(limit + 1)
    .where(where)
    .orderBy(desc(activityEvents.createdAt), desc(activityEvents.id));

  const entries = rows.slice(0, limit) as TimelineEntry[];
  const hasMore = rows.length > limit;
  const last = entries[entries.length - 1];

  return {
    entries,
    nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null,
  };
}

/** `<iso>|<id>`. Opaque to the caller, and cheap to read back. */
function encodeCursor(createdAt: Date, id: string): string {
  return `${createdAt.toISOString()}|${id}`;
}

function parseCursor(
  cursor: string | undefined,
): { createdAt: Date; id: string } | null {
  if (!cursor) return null;
  const [iso, id] = cursor.split("|");
  if (!iso || !id) return null;
  const createdAt = new Date(iso);
  // A malformed cursor is a probe or a stale link. Starting from the top is a
  // better answer than an error page for what is only a scroll position.
  return Number.isNaN(createdAt.getTime()) ? null : { createdAt, id };
}

export { parseListParams, encodeCursor, parseCursor };
