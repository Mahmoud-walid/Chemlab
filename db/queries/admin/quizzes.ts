import "server-only";
import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  isNull,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";

import { getDb } from "@/db/client";
import {
  quizOptions,
  quizQuestions,
  quizzes,
  type ContentStatus,
} from "@/db/schema/content";
import { offsetFor, pageCount, type ListParams } from "./list-params";

/**
 * Quizzes for the admin list and editor.
 *
 * #16 calls this section "exams". It is named `quizzes` here and in the admin
 * UI, because that is what the table, the public `/quiz` route, the seed data
 * and the `quiz:*` permissions all call it — and because `exam:read` already
 * means something else in the permission catalogue: viewing attempts and
 * scores. The nav previously pointed this section at `exam:read`, which meant
 * an Editor holding every `quiz:*` permission could not see it at all.
 *
 * Unlike the public queries these see every status, but they still hide
 * soft-deleted rows from the list: a deleted quiz in the list is a quiz
 * someone will try to edit.
 */

export const QUIZ_SORT_COLUMNS = [
  "position",
  "title",
  "slug",
  "category",
  "difficulty",
  "status",
  "updatedAt",
] as const;

export type QuizSort = (typeof QUIZ_SORT_COLUMNS)[number];

export const QUIZ_LIST_SPEC = {
  sortable: QUIZ_SORT_COLUMNS,
  defaultSort: "position" as const,
};

export interface QuizRow {
  id: string;
  slug: string;
  title: string;
  category: string;
  difficulty: "easy" | "medium" | "hard";
  status: ContentStatus;
  position: number;
  questionCount: number;
  updatedAt: Date;
}

export interface QuizPage {
  rows: QuizRow[];
  total: number;
  pages: number;
}

function orderColumn(sort: QuizSort) {
  switch (sort) {
    case "title":
      return quizzes.title;
    case "slug":
      return quizzes.slug;
    case "category":
      return quizzes.category;
    case "difficulty":
      return quizzes.difficulty;
    case "status":
      return quizzes.status;
    case "updatedAt":
      return quizzes.updatedAt;
    default:
      return quizzes.position;
  }
}

function filters(params: ListParams<QuizSort>, status?: ContentStatus) {
  const clauses: (SQL | undefined)[] = [isNull(quizzes.deletedAt)];

  if (status) clauses.push(eq(quizzes.status, status));

  if (params.query) {
    const pattern = `%${params.query}%`;
    clauses.push(
      or(
        ilike(quizzes.title, pattern),
        ilike(quizzes.slug, pattern),
        ilike(quizzes.category, pattern),
      ),
    );
  }

  return and(...clauses.filter(Boolean));
}

export async function listQuizzesForAdmin(
  params: ListParams<QuizSort>,
  status?: ContentStatus,
): Promise<QuizPage> {
  const db = getDb();
  const where = filters(params, status);
  const order = params.direction === "desc" ? desc : asc;

  const [{ total }] = await db
    .select({ total: count() })
    .from(quizzes)
    .where(where);

  const rows = await db
    .select({
      id: quizzes.id,
      slug: quizzes.slug,
      title: quizzes.title,
      category: quizzes.category,
      difficulty: quizzes.difficulty,
      status: quizzes.status,
      position: quizzes.position,
      // `db.$count` builds a real correlated subquery with its columns
      // qualified. A hand-written `sql` subquery does not: drizzle renders the
      // columns bare, and an unqualified `"id"` inside one binds to the INNER
      // table — which counts zero, silently.
      questionCount: db.$count(
        quizQuestions,
        eq(quizQuestions.quizId, quizzes.id),
      ),
      updatedAt: quizzes.updatedAt,
    })
    .from(quizzes)
    .where(where)
    .orderBy(
      order(orderColumn(params.sort)),
      // A stable tiebreak, so two quizzes sharing a position do not swap places
      // between pages and make a row appear twice or not at all.
      asc(quizzes.slug),
    )
    .limit(params.pageSize)
    .offset(offsetFor(params.page, params.pageSize, total ?? 0));

  return {
    rows: rows.map((row) => ({
      ...row,
      questionCount: Number(row.questionCount),
    })),
    total: total ?? 0,
    pages: pageCount(total ?? 0, params.pageSize),
  };
}

export interface AdminQuizQuestionOption {
  id: string;
  label: string;
}

export interface AdminQuizQuestion {
  id: string;
  prompt: string;
  explanation: string;
  points: number;
  options: AdminQuizQuestionOption[];
  /** Index into `options`, or -1 when the stored answer resolves to nothing. */
  correctIndex: number;
}

export interface AdminQuiz {
  id: string;
  slug: string;
  title: string;
  description: string;
  difficulty: "easy" | "medium" | "hard";
  category: string;
  status: ContentStatus;
  position: number;
  timeLimitSeconds: number | null;
  passMarkPercent: number;
  maxAttempts: number | null;
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  publishedAt: Date | null;
  deletedAt: Date | null;
  updatedAt: Date;
  questions: AdminQuizQuestion[];
}

/**
 * One quiz with its questions and options, soft-deleted rows included.
 *
 * Included deliberately: the editor is where a deleted quiz would be restored
 * from, and a 404 there would leave no way back.
 *
 * A LEFT join to options, not an inner one: a question mid-edit can have none,
 * and an inner join would make it disappear from its own editor.
 */
export async function getQuizForAdmin(slug: string): Promise<AdminQuiz | null> {
  const db = getDb();

  const [quiz] = await db
    .select()
    .from(quizzes)
    .where(eq(quizzes.slug, slug))
    .limit(1);

  if (!quiz) return null;

  const rows = await db
    .select({
      questionId: quizQuestions.id,
      questionPosition: quizQuestions.position,
      prompt: quizQuestions.prompt,
      explanation: quizQuestions.explanation,
      points: quizQuestions.points,
      correctOptionId: quizQuestions.correctOptionId,
      optionId: quizOptions.id,
      optionPosition: quizOptions.position,
      label: quizOptions.label,
    })
    .from(quizQuestions)
    .leftJoin(quizOptions, eq(quizOptions.questionId, quizQuestions.id))
    .where(eq(quizQuestions.quizId, quiz.id))
    .orderBy(asc(quizQuestions.position), asc(quizOptions.position));

  const byQuestion = new Map<
    string,
    AdminQuizQuestion & { answerId: string | null }
  >();

  for (const row of rows) {
    let question = byQuestion.get(row.questionId);
    if (!question) {
      question = {
        id: row.questionId,
        prompt: row.prompt,
        explanation: row.explanation,
        points: row.points,
        options: [],
        correctIndex: -1,
        answerId: row.correctOptionId,
      };
      byQuestion.set(row.questionId, question);
    }
    if (row.optionId) {
      question.options.push({ id: row.optionId, label: row.label! });
    }
  }

  const questions = [...byQuestion.values()].map(
    ({ answerId, ...question }) => ({
      ...question,
      // Resolved from the stored reference rather than trusted: -1 means the
      // answer points at nothing, which the editor shows as "no answer marked"
      // instead of silently selecting the first option.
      correctIndex: question.options.findIndex(
        (option) => option.id === answerId,
      ),
    }),
  );

  return { ...quiz, questions };
}

/** Counts for the publish check: how many questions, and how many are broken. */
export async function quizPublishCounts(
  quizId: string,
): Promise<{ questionCount: number; unanswerableCount: number }> {
  const db = getDb();

  const [row] = await db
    .select({
      questionCount: count(),
      // A question is unanswerable when its correct option is null, or when it
      // points at an option that no longer exists — the FK is nullable, so the
      // second case is reachable.
      unanswerable: sql<number>`count(*) filter (
        where ${quizQuestions.correctOptionId} is null
           or not exists (
             select 1 from ${quizOptions}
             where ${quizOptions}."id" = ${quizQuestions}."correct_option_id"
           )
      )::int`,
    })
    .from(quizQuestions)
    .where(eq(quizQuestions.quizId, quizId));

  return {
    questionCount: Number(row?.questionCount ?? 0),
    unanswerableCount: Number(row?.unanswerable ?? 0),
  };
}

/**
 * Whether a slug is already taken by a different quiz.
 *
 * Checked before the write for a message the author can act on, and enforced
 * again by the unique index — this query and the INSERT are not atomic, so two
 * authors submitting the same new slug at once would both pass here.
 */
export async function isQuizSlugTaken(
  slug: string,
  exceptId?: string,
): Promise<boolean> {
  const [row] = await getDb()
    .select({ id: quizzes.id })
    .from(quizzes)
    .where(
      exceptId
        ? and(eq(quizzes.slug, slug), ne(quizzes.id, exceptId))
        : eq(quizzes.slug, slug),
    )
    .limit(1);

  return Boolean(row);
}

/** The next free position, so a new quiz lands at the end of the sequence. */
export async function nextQuizPosition(): Promise<number> {
  const [row] = await getDb()
    .select({ max: sql<number | null>`max(${quizzes.position})` })
    .from(quizzes);
  return (row?.max ?? 0) + 10;
}
