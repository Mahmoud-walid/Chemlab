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

import type { PgSelectQueryBuilder } from "drizzle-orm/pg-core";

import { getDb } from "@/db/client";
import {
  lessonSectionTranslations,
  lessonSections,
  lessonTranslations,
  lessons,
} from "@/db/schema/content";
import type { ContentStatus } from "@/db/schema/content";
import { offsetFor, pageCount, type ListParams } from "./list-params";
import { childRankExpression, rowRank, worstRank } from "./translation-rank";
import {
  TRANSLATION_RANK,
  stateFromRank,
  type TranslationState,
} from "@/lib/translations/state";

/**
 * Lessons for the admin list and editor.
 *
 * Unlike the public queries these see every status — that is the whole point
 * of the screen — but they still hide soft-deleted rows by default, because a
 * deleted lesson in the list is a lesson someone will try to edit.
 */

export const LESSON_SORT_COLUMNS = [
  "position",
  "title",
  "slug",
  "category",
  "difficulty",
  "status",
  "updatedAt",
] as const;

export type LessonSort = (typeof LESSON_SORT_COLUMNS)[number];

export const LESSON_LIST_SPEC = {
  sortable: LESSON_SORT_COLUMNS,
  defaultSort: "position" as const,
};

export interface LessonRow {
  id: string;
  slug: string;
  title: string;
  category: string;
  difficulty: "easy" | "medium" | "hard";
  status: ContentStatus;
  position: number;
  /** Zero means there is nothing to read yet — and nothing to publish. */
  sectionCount: number;
  /**
   * How translated this lesson is into the target locale, counting its
   * sections — worst part wins. Absent when the target locale IS the default
   * one, where the question does not arise.
   */
  translation?: TranslationState;
  updatedAt: Date;
}

export interface LessonPage {
  rows: LessonRow[];
  total: number;
  pages: number;
}

function orderColumn(sort: LessonSort) {
  switch (sort) {
    case "title":
      return lessons.title;
    case "slug":
      return lessons.slug;
    case "category":
      return lessons.category;
    case "difficulty":
      return lessons.difficulty;
    case "status":
      return lessons.status;
    case "updatedAt":
      return lessons.updatedAt;
    default:
      return lessons.position;
  }
}

function filters(params: ListParams<LessonSort>, status?: ContentStatus) {
  const clauses: (SQL | undefined)[] = [isNull(lessons.deletedAt)];

  if (status) clauses.push(eq(lessons.status, status));

  if (params.query) {
    const pattern = `%${params.query}%`;
    clauses.push(
      or(
        ilike(lessons.title, pattern),
        ilike(lessons.slug, pattern),
        ilike(lessons.category, pattern),
      ),
    );
  }

  return and(...clauses.filter(Boolean));
}

/**
 * How many sections each lesson has, as a derived table joined on lesson id.
 *
 * Not a hand-written correlated subquery: inside one, drizzle renders columns
 * unqualified, so `where ${lessonSections.lessonId} = ${lessons.id}` came out
 * as `where "lesson_id" = "id"` — and `"id"` there resolves to the INNER
 * table. That compares a row to itself, returns 0 for every lesson, and does
 * it silently. A derived table is aliased, so every reference is qualified and
 * cannot bind to the wrong relation.
 */
function sectionCounts(db: ReturnType<typeof getDb>) {
  return db
    .select({
      lessonId: lessonSections.lessonId,
      total: count().as("total"),
    })
    .from(lessonSections)
    .groupBy(lessonSections.lessonId)
    .as("section_counts");
}

/**
 * The worst translation rank across a lesson's sections, per lesson.
 *
 * A derived table rather than a correlated subquery, for the same reason
 * `sectionCounts` is one: inside a correlated subquery drizzle renders
 * columns unqualified, and `"id"` binds to the inner table. A lesson with no
 * sections gets no row here at all, and the caller's `coalesce(..., 0)` reads
 * that as "nothing outstanding" — which is right: a summary-only lesson has
 * nothing left to translate.
 */
function sectionTranslationRanks(db: ReturnType<typeof getDb>, locale: string) {
  return db
    .select({
      lessonId: lessonSections.lessonId,
      rank: childRankExpression(lessonSectionTranslations, lessonSections).as(
        "rank",
      ),
    })
    .from(lessonSections)
    .leftJoin(
      lessonSectionTranslations,
      and(
        eq(lessonSectionTranslations.sectionId, lessonSections.id),
        eq(lessonSectionTranslations.locale, locale),
      ),
    )
    .groupBy(lessonSections.lessonId)
    .as("section_translation_ranks");
}

export interface AdminLessonListOptions {
  status?: ContentStatus;
  /**
   * Which locale the translation column is about. Omit — or pass the default
   * locale — and the column is not computed at all: the joins cost nothing
   * to skip, and "how translated is English into English" is not a question.
   */
  translationLocale?: string;
  /** Narrow to lessons in one translation state, e.g. `missing` or `stale`. */
  translationState?: TranslationState;
}

export async function listLessonsForAdmin(
  params: ListParams<LessonSort>,
  options: ContentStatus | AdminLessonListOptions = {},
): Promise<LessonPage> {
  // The second argument used to be the status alone. Both shapes are accepted
  // rather than updating every call site to pass an object for one field.
  const { status, translationLocale, translationState } =
    typeof options === "string" ? { status: options } : options;

  const db = getDb();
  const order = params.direction === "desc" ? desc : asc;
  const counts = sectionCounts(db);

  const wantsTranslation = Boolean(translationLocale);
  const sectionRanks = translationLocale
    ? sectionTranslationRanks(db, translationLocale)
    : undefined;

  // The rank, once: selected AND filtered on, so the column an editor reads
  // and the filter that narrowed to it are the same expression by
  // construction rather than by two definitions agreeing.
  const rank =
    sectionRanks && translationLocale
      ? worstRank(
          rowRank(lessonTranslations, lessons),
          sql<number>`${sectionRanks.rank}`,
        )
      : undefined;

  function joinTranslations<T extends PgSelectQueryBuilder>(query: T): T {
    if (!translationLocale || !sectionRanks) return query;
    return (
      query
        .leftJoin(
          lessonTranslations,
          and(
            eq(lessonTranslations.lessonId, lessons.id),
            eq(lessonTranslations.locale, translationLocale),
          ),
        )
        // The cast: adding a left join widens the builder's type, but nothing
        // downstream selects from the joined tables — the rank expression
        // already carries their columns — so the narrower type is the accurate
        // one for the caller.
        .leftJoin(
          sectionRanks,
          eq(sectionRanks.lessonId, lessons.id),
        ) as unknown as T
    );
  }

  const where =
    rank && translationState !== undefined
      ? and(
          filters(params, status),
          sql`${rank} = ${TRANSLATION_RANK[translationState]}`,
        )
      : filters(params, status);

  // `$dynamic()` so the two translation joins can be added conditionally.
  // Without it the builder's type is fixed at construction and the branch has
  // to be written as two whole copies of the query — which is how one copy
  // gains a filter the other does not, and the count stops matching the rows.
  const totalQuery = db.select({ total: count() }).from(lessons).$dynamic();
  const [{ total }] = await joinTranslations(totalQuery).where(where);

  const rowsQuery = db
    .select({
      id: lessons.id,
      slug: lessons.slug,
      title: lessons.title,
      category: lessons.category,
      difficulty: lessons.difficulty,
      status: lessons.status,
      position: lessons.position,
      // A lesson with no sections has no row in the derived table at all, so
      // the join yields null — which is zero, not "unknown".
      sectionCount: sql<number>`coalesce(${counts.total}, 0)::int`,
      translationRank: rank ?? sql<number | null>`null::int`,
      updatedAt: lessons.updatedAt,
    })
    .from(lessons)
    .leftJoin(counts, eq(counts.lessonId, lessons.id))
    .$dynamic();

  const rows = await joinTranslations(rowsQuery)
    .where(where)
    .orderBy(
      order(orderColumn(params.sort)),
      // A stable tiebreak, so two lessons sharing a position do not swap
      // places between pages and make a row appear twice or not at all.
      asc(lessons.slug),
    )
    .limit(params.pageSize)
    .offset(offsetFor(params.page, params.pageSize, total ?? 0));

  return {
    rows: rows.map(({ translationRank, ...row }) => ({
      ...row,
      translation: wantsTranslation
        ? stateFromRank(Number(translationRank ?? 0))
        : undefined,
    })),
    total: total ?? 0,
    pages: pageCount(total ?? 0, params.pageSize),
  };
}

export interface AdminLesson {
  id: string;
  slug: string;
  title: string;
  description: string;
  difficulty: "easy" | "medium" | "hard";
  category: string;
  coverImageUrl: string | null;
  references: string[];
  tags: string[];
  status: ContentStatus;
  position: number;
  publishedAt: Date | null;
  deletedAt: Date | null;
  sectionCount: number;
  updatedAt: Date;
}

/**
 * One lesson by slug, soft-deleted rows included.
 *
 * Included deliberately: the editor is where a deleted lesson would be
 * restored from, and a 404 there would leave no way back.
 */
export async function getLessonForAdmin(
  slug: string,
): Promise<AdminLesson | null> {
  const db = getDb();
  const counts = sectionCounts(db);

  const [row] = await db
    .select({
      id: lessons.id,
      slug: lessons.slug,
      title: lessons.title,
      description: lessons.description,
      difficulty: lessons.difficulty,
      category: lessons.category,
      coverImageUrl: lessons.coverImageUrl,
      references: lessons.references,
      tags: lessons.tags,
      status: lessons.status,
      position: lessons.position,
      publishedAt: lessons.publishedAt,
      deletedAt: lessons.deletedAt,
      sectionCount: sql<number>`coalesce(${counts.total}, 0)::int`,
      updatedAt: lessons.updatedAt,
    })
    .from(lessons)
    .leftJoin(counts, eq(counts.lessonId, lessons.id))
    .where(eq(lessons.slug, slug))
    .limit(1);

  return row ?? null;
}

/**
 * Whether a slug is already taken by a different lesson.
 *
 * Checked before the write for a message the author can act on, and enforced
 * again by the unique index — this query and the INSERT are not atomic, so two
 * authors submitting the same new slug at once would both pass here. The
 * action catches the constraint violation and reports the same message.
 *
 * Soft-deleted lessons still hold their slug: the row is still there, the
 * index still covers it, and reusing the slug of a withdrawn lesson would
 * re-point every existing link to different content.
 */
export async function isSlugTaken(
  slug: string,
  exceptId?: string,
): Promise<boolean> {
  const [row] = await getDb()
    .select({ id: lessons.id })
    .from(lessons)
    .where(
      exceptId
        ? and(eq(lessons.slug, slug), ne(lessons.id, exceptId))
        : eq(lessons.slug, slug),
    )
    .limit(1);

  return Boolean(row);
}

/** The next free position, so a new lesson lands at the end of the sequence. */
export async function nextLessonPosition(): Promise<number> {
  const [row] = await getDb()
    .select({ max: sql<number | null>`max(${lessons.position})` })
    .from(lessons);
  return (row?.max ?? 0) + 10;
}
