import "server-only";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";

import { getDb } from "@/db/client";
import { attemptAnswers, examAttempts } from "@/db/schema/attempts";
import { users } from "@/db/schema/auth";
import { quizQuestions, quizzes } from "@/db/schema/content";
import { percentage } from "@/lib/exams/score";
import {
  parseListParams,
  type ListParams,
  type ListParamsSpec,
} from "./list-params";

/**
 * Reading attempts, for the people who run the platform.
 *
 * Two claims shape everything here. First, a candidate's mark is already
 * computed and stored — nothing recomputes a score at read time, so the admin
 * screens cannot disagree with what the candidate was shown. Second, the
 * aggregates are computed in SQL rather than by loading every attempt and
 * reducing in TypeScript: a quiz with ten thousand sittings would otherwise
 * mean ten thousand rows crossing the wire to produce one average.
 */

export const ATTEMPT_LIST_SPEC = {
  sortable: ["startedAt", "score", "attemptNumber"],
  defaultSort: "startedAt",
  defaultDirection: "desc",
} as const satisfies ListParamsSpec<"startedAt" | "score" | "attemptNumber">;

export type AttemptSort = (typeof ATTEMPT_LIST_SPEC)["sortable"][number];

export interface QuizAttemptSummary {
  slug: string;
  title: string;
  status: string;
  /** Sittings that reached a mark. In-progress ones are counted separately. */
  finished: number;
  inProgress: number;
  voided: number;
  /** Mean percent across finished, unvoided attempts. Null when there are none. */
  averagePercent: number | null;
  passRate: number | null;
  lastAttemptAt: Date | null;
}

/**
 * One row per quiz, with its sitting counts.
 *
 * A voided attempt is counted in its own column rather than folded into
 * `finished`: it happened, and hiding it would make "12 sittings" disagree
 * with a list showing 13.
 */
export async function listQuizAttemptSummaries(): Promise<
  QuizAttemptSummary[]
> {
  const db = getDb();

  const rows = await db
    .select({
      slug: quizzes.slug,
      title: quizzes.title,
      status: quizzes.status,
      finished: sql<number>`count(*) filter (
        where ${examAttempts.status} in ('submitted', 'expired')
      )::int`,
      inProgress: sql<number>`count(*) filter (
        where ${examAttempts.status} = 'in_progress'
      )::int`,
      voided: sql<number>`count(*) filter (
        where ${examAttempts.status} = 'voided'
      )::int`,
      // Averaged over the marked, unvoided attempts only. Including a voided
      // sitting would let a struck-out attempt still move the quiz's average.
      averagePercent: sql<number | null>`round(avg(
        case when ${examAttempts.status} in ('submitted', 'expired')
             and coalesce(${examAttempts.maxScore}, 0) > 0
        then ${examAttempts.score}::numeric * 100 / ${examAttempts.maxScore}
        end
      ))::int`,
      passRate: sql<number | null>`round(100.0 * count(*) filter (
        where ${examAttempts.status} in ('submitted', 'expired')
          and ${examAttempts.passed}
      ) / nullif(count(*) filter (
        where ${examAttempts.status} in ('submitted', 'expired')
      ), 0))::int`,
      lastAttemptAt: sql<Date | null>`max(${examAttempts.startedAt})`,
    })
    .from(quizzes)
    // LEFT, so a quiz nobody has sat still appears with zeroes. An inner join
    // would silently drop exactly the quizzes worth noticing.
    .leftJoin(examAttempts, eq(examAttempts.quizId, quizzes.id))
    .where(isNull(quizzes.deletedAt))
    .groupBy(
      quizzes.id,
      quizzes.slug,
      quizzes.title,
      quizzes.status,
      quizzes.position,
    )
    .orderBy(asc(quizzes.position), asc(quizzes.title));

  return rows;
}

export interface ScoreBucket {
  /** Lower bound, inclusive: 0, 10, … 90. The last bucket includes 100. */
  from: number;
  count: number;
}

export interface QuestionStat {
  id: string;
  position: number;
  prompt: string;
  answered: number;
  correct: number;
  /** Percent of ANSWERED attempts that got it right, or null if none. */
  percentCorrect: number | null;
  /** How often it was left blank. A blank is not a wrong answer. */
  skipped: number;
}

export interface AttemptRow {
  id: string;
  attemptNumber: number;
  status: string;
  score: number | null;
  maxScore: number | null;
  percent: number;
  passed: boolean | null;
  startedAt: Date;
  submittedAt: Date | null;
  voidReason: string | null;
  userId: string;
  userName: string | null;
  userEmail: string | null;
}

export interface QuizAttemptDetail {
  slug: string;
  title: string;
  distribution: ScoreBucket[];
  questions: QuestionStat[];
  attempts: AttemptRow[];
  total: number;
}

/** Ten-point buckets, always all ten, so an empty band renders as a gap. */
const BUCKETS = Array.from({ length: 10 }, (_, i) => i * 10);

export async function getQuizAttemptDetail(
  slug: string,
  params: ListParams<AttemptSort>,
): Promise<QuizAttemptDetail | null> {
  const db = getDb();

  const [quiz] = await db
    .select({ id: quizzes.id, slug: quizzes.slug, title: quizzes.title })
    .from(quizzes)
    .where(and(eq(quizzes.slug, slug), isNull(quizzes.deletedAt)));
  if (!quiz) return null;

  const marked = and(
    eq(examAttempts.quizId, quiz.id),
    inArray(examAttempts.status, ["submitted", "expired"]),
  );

  // The distribution, bucketed in SQL. `width_bucket` would work too, but the
  // arithmetic here is short enough to read and does not need the 100 case
  // special-cased into an eleventh bucket.
  const distributionRows = await db
    .select({
      bucket: sql<number>`least(9, floor(
        ${examAttempts.score}::numeric * 10 / nullif(${examAttempts.maxScore}, 0)
      ))::int`,
      count: sql<number>`count(*)::int`,
    })
    .from(examAttempts)
    .where(and(marked, sql`coalesce(${examAttempts.maxScore}, 0) > 0`))
    .groupBy(
      sql`least(9, floor(${examAttempts.score}::numeric * 10 / nullif(${examAttempts.maxScore}, 0)))`,
    );

  const byBucket = new Map(
    distributionRows.map((row) => [row.bucket, row.count]),
  );
  const distribution = BUCKETS.map((from) => ({
    from,
    count: byBucket.get(from / 10) ?? 0,
  }));

  // Per-question difficulty. `answered` excludes blanks on purpose: a question
  // nobody reached is not a hard question, and averaging blanks into
  // "percent correct" makes a long paper look harder than it is.
  const questionRows = await db
    .select({
      id: quizQuestions.id,
      position: quizQuestions.position,
      prompt: quizQuestions.prompt,
      answered: sql<number>`count(*) filter (
        where jsonb_array_length(${attemptAnswers.selectedOptionIds}) > 0
      )::int`,
      correct: sql<number>`count(*) filter (where ${attemptAnswers.isCorrect})::int`,
      skipped: sql<number>`count(*) filter (
        where ${attemptAnswers.attemptId} is not null
          and jsonb_array_length(${attemptAnswers.selectedOptionIds}) = 0
      )::int`,
    })
    .from(quizQuestions)
    .leftJoin(
      attemptAnswers,
      and(
        eq(attemptAnswers.questionId, quizQuestions.id),
        // Scoped inside the join, not the WHERE: a question with no answers at
        // all must still produce a row, and moving this to WHERE would drop it.
        sql`exists (
          select 1 from ${examAttempts}
          where ${examAttempts.id} = ${attemptAnswers.attemptId}
            and ${examAttempts.quizId} = ${quiz.id}
            and ${examAttempts.status} in ('submitted', 'expired')
        )`,
      ),
    )
    .where(eq(quizQuestions.quizId, quiz.id))
    .groupBy(quizQuestions.id, quizQuestions.position, quizQuestions.prompt)
    .orderBy(asc(quizQuestions.position));

  const questions: QuestionStat[] = questionRows.map((row) => ({
    ...row,
    percentCorrect:
      row.answered > 0 ? percentage(row.correct, row.answered) : null,
  }));

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(examAttempts)
    .where(eq(examAttempts.quizId, quiz.id));

  const order = {
    startedAt: examAttempts.startedAt,
    score: examAttempts.score,
    attemptNumber: examAttempts.attemptNumber,
  }[params.sort];

  const rows = await db
    .select({
      id: examAttempts.id,
      attemptNumber: examAttempts.attemptNumber,
      status: examAttempts.status,
      score: examAttempts.score,
      maxScore: examAttempts.maxScore,
      passed: examAttempts.passed,
      startedAt: examAttempts.startedAt,
      submittedAt: examAttempts.submittedAt,
      voidReason: examAttempts.voidReason,
      userId: examAttempts.userId,
      userName: users.name,
      userEmail: users.email,
    })
    .from(examAttempts)
    // LEFT, because `users` rows go away and an attempt must not vanish with
    // the account that made it — the score is still part of the quiz's history.
    .leftJoin(users, eq(users.id, examAttempts.userId))
    .where(eq(examAttempts.quizId, quiz.id))
    .orderBy(params.direction === "asc" ? asc(order) : desc(order))
    .limit(params.pageSize)
    .offset((params.page - 1) * params.pageSize);

  return {
    slug: quiz.slug,
    title: quiz.title,
    distribution,
    questions,
    attempts: rows.map((row) => ({
      ...row,
      percent: percentage(row.score ?? 0, row.maxScore ?? 0),
    })),
    total,
  };
}

/** Every sitting one person has taken, newest first. */
export async function getUserAttemptHistory(
  userId: string,
): Promise<AttemptRow[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: examAttempts.id,
      attemptNumber: examAttempts.attemptNumber,
      status: examAttempts.status,
      score: examAttempts.score,
      maxScore: examAttempts.maxScore,
      passed: examAttempts.passed,
      startedAt: examAttempts.startedAt,
      submittedAt: examAttempts.submittedAt,
      voidReason: examAttempts.voidReason,
      userId: examAttempts.userId,
      userName: users.name,
      userEmail: users.email,
      quizSlug: quizzes.slug,
      quizTitle: quizzes.title,
    })
    .from(examAttempts)
    .innerJoin(quizzes, eq(quizzes.id, examAttempts.quizId))
    .leftJoin(users, eq(users.id, examAttempts.userId))
    .where(eq(examAttempts.userId, userId))
    .orderBy(desc(examAttempts.startedAt));

  return rows.map((row) => ({
    ...row,
    percent: percentage(row.score ?? 0, row.maxScore ?? 0),
  }));
}

export { parseListParams };
