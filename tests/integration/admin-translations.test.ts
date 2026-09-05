import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { uuidv7 } from "uuidv7";

import { connect, seedUrl, type SeedDatabase } from "@/db/seed/connect";
import * as schema from "@/db/schema";
import {
  LESSON_LIST_SPEC,
  listLessonsForAdmin,
} from "@/db/queries/admin/lessons";
import {
  QUIZ_LIST_SPEC,
  listQuizzesForAdmin,
} from "@/db/queries/admin/quizzes";
import { parseListParams } from "@/db/queries/admin/list-params";
import type { TranslationState } from "@/lib/translations/state";

/**
 * The admin list's translation column, against real Postgres.
 *
 * The column is computed in SQL because the list FILTERS on it — a rank
 * derived after paging would filter one page at a time. So the thing worth
 * testing is the SQL: that `greatest()` really takes the worst part, that a
 * lesson with no sections is not permanently "missing", and that the filter
 * and the column agree.
 */

let db: SeedDatabase;
let close: () => Promise<void>;

const PREFIX = `xlate-${uuidv7()}`;
const ids: string[] = [];

/** A lesson with a slug this suite can find and clean up. */
async function lesson(name: string): Promise<string> {
  const id = uuidv7();
  ids.push(id);
  await db.insert(schema.lessons).values({
    id,
    slug: `${PREFIX}-${name}`,
    title: `Lesson ${name}`,
    description: "For the translation column.",
    difficulty: "easy",
    category: PREFIX,
    status: "published",
  });
  return id;
}

async function section(lessonId: string, position = 1): Promise<string> {
  const id = uuidv7();
  await db.insert(schema.lessonSections).values({
    id,
    lessonId,
    position,
    heading: `Heading ${position}`,
    body: [{ id: "b1", type: "paragraph", text: [{ text: "Words." }] }],
  });
  return id;
}

const currentHash = (table: "lessons" | "lesson_sections", id: string) =>
  table === "lessons"
    ? sql`(select source_hash from lessons where id = ${id})`
    : sql`(select source_hash from lesson_sections where id = ${id})`;

async function translateLesson(
  lessonId: string,
  status: "draft" | "in_review" | "published",
) {
  await db.insert(schema.lessonTranslations).values({
    lessonId,
    locale: "ar",
    title: "عنوان",
    description: "وصف",
    status,
    sourceHash: currentHash("lessons", lessonId),
  });
}

async function translateSection(
  sectionId: string,
  status: "draft" | "in_review" | "published",
) {
  await db.insert(schema.lessonSectionTranslations).values({
    sectionId,
    locale: "ar",
    heading: "عنوان فرعي",
    body: [{ id: "b1", type: "paragraph", text: [{ text: "كلمات." }] }],
    status,
    sourceHash: currentHash("lesson_sections", sectionId),
  });
}

/** Only this suite's lessons, so the seeded catalogue does not drown them. */
async function statesByName(
  translationState?: TranslationState,
): Promise<Record<string, TranslationState | undefined>> {
  const { rows } = await listLessonsForAdmin(
    parseListParams({ q: PREFIX, pageSize: "50" }, LESSON_LIST_SPEC),
    { translationLocale: "ar", translationState },
  );
  return Object.fromEntries(
    rows.map((row) => [row.slug.replace(`${PREFIX}-`, ""), row.translation]),
  );
}

beforeAll(async () => {
  const url = seedUrl();
  if (!url) throw new Error("no database URL");
  ({ db, close } = connect(url));

  // untranslated: nothing at all.
  await lesson("untranslated");

  // summary-only: no sections, and a current translation. The case that
  // would read as "missing" forever if an empty aggregate were treated as
  // one untranslated part.
  await translateLesson(await lesson("summary-only"), "published");

  // complete: lesson and section both published and current.
  const complete = await lesson("complete");
  await translateLesson(complete, "published");
  await translateSection(await section(complete), "published");

  // half-done: the summary is translated, one section is not. The failure
  // this column exists to make visible.
  const half = await lesson("half-done");
  await translateLesson(half, "published");
  await section(half, 1);
  await translateSection(await section(half, 2), "published");

  // drafted: a section translation nobody has published.
  const drafted = await lesson("drafted");
  await translateLesson(drafted, "published");
  await translateSection(await section(drafted), "draft");

  // gone-stale: everything published, then the English section is edited.
  const staleOne = await lesson("gone-stale");
  await translateLesson(staleOne, "published");
  const staleSection = await section(staleOne);
  await translateSection(staleSection, "published");
  await db
    .update(schema.lessonSections)
    .set({ heading: "Heading 1, revised" })
    .where(eq(schema.lessonSections.id, staleSection));
});

afterAll(async () => {
  for (const id of ids) {
    await db.delete(schema.lessons).where(eq(schema.lessons.id, id));
  }
  await close?.();
});

describe("the translation column", () => {
  it("reports the worst part of each lesson", async () => {
    expect(await statesByName()).toEqual({
      untranslated: "missing",
      // No sections is nothing outstanding, not "missing".
      "summary-only": "published",
      complete: "published",
      // The summary is fine; one section has no Arabic at all.
      "half-done": "missing",
      drafted: "draft",
      "gone-stale": "stale",
    });
  });

  it("is absent entirely when no locale is asked about", async () => {
    // The joins are skipped rather than computed and ignored: "how translated
    // is English into English" is not a question.
    const { rows } = await listLessonsForAdmin(
      parseListParams({ q: PREFIX, pageSize: "50" }, LESSON_LIST_SPEC),
    );
    expect(rows.every((row) => row.translation === undefined)).toBe(true);
  });
});

describe("the translation filter", () => {
  it("narrows to what is missing", async () => {
    expect(Object.keys(await statesByName("missing")).sort()).toEqual([
      "half-done",
      "untranslated",
    ]);
  });

  it("narrows to what has gone stale", async () => {
    expect(Object.keys(await statesByName("stale"))).toEqual(["gone-stale"]);
  });

  it("narrows to what is waiting to be published", async () => {
    expect(Object.keys(await statesByName("draft"))).toEqual(["drafted"]);
  });

  it("counts the same rows it lists", async () => {
    // The count query and the rows query are separate statements. If only one
    // of them carried the translation joins, the pager would promise pages
    // that do not exist — which is exactly why they share `$dynamic()` and
    // one `where`.
    const { rows, total } = await listLessonsForAdmin(
      parseListParams({ q: PREFIX, pageSize: "50" }, LESSON_LIST_SPEC),
      { translationLocale: "ar", translationState: "missing" },
    );
    expect(total).toBe(rows.length);
    expect(total).toBe(2);
  });
});

/**
 * The same column over quizzes, which aggregate over QUESTIONS rather than
 * sections. Written out rather than shared with the lessons suite: the two
 * queries are separate SQL, and a helper that ran both would let one of them
 * regress while the other kept the test green.
 */
describe("the quiz translation column", () => {
  const quizIds: string[] = [];

  async function quiz(name: string): Promise<string> {
    const id = uuidv7();
    quizIds.push(id);
    await db.insert(schema.quizzes).values({
      id,
      slug: `${PREFIX}-q-${name}`,
      title: `Quiz ${name}`,
      description: "For the translation column.",
      difficulty: "easy",
      category: PREFIX,
      status: "published",
    });
    return id;
  }

  async function question(quizId: string, position = 1): Promise<string> {
    const id = uuidv7();
    await db.insert(schema.quizQuestions).values({
      id,
      quizId,
      position,
      prompt: `Prompt ${position}`,
      explanation: "Because.",
    });
    return id;
  }

  async function translateQuiz(quizId: string, status: "draft" | "published") {
    await db.insert(schema.quizTranslations).values({
      quizId,
      locale: "ar",
      title: "اختبار",
      description: "وصف",
      status,
      sourceHash: sql`(select source_hash from quizzes where id = ${quizId})`,
    });
  }

  async function translateQuestion(
    questionId: string,
    status: "draft" | "published",
  ) {
    await db.insert(schema.quizQuestionTranslations).values({
      questionId,
      locale: "ar",
      prompt: "سؤال",
      explanation: "لأن.",
      status,
      sourceHash: sql`(select source_hash from quiz_questions where id = ${questionId})`,
    });
  }

  beforeAll(async () => {
    await quiz("untranslated");

    const done = await quiz("complete");
    await translateQuiz(done, "published");
    await translateQuestion(await question(done), "published");

    // The case that matters most for a quiz: the title is Arabic, one
    // question is not. A reader would sit a paper in two languages.
    const partial = await quiz("half-done");
    await translateQuiz(partial, "published");
    await question(partial, 1);
    await translateQuestion(await question(partial, 2), "published");

    const drifted = await quiz("gone-stale");
    await translateQuiz(drifted, "published");
    const drifting = await question(drifted);
    await translateQuestion(drifting, "published");
    await db
      .update(schema.quizQuestions)
      .set({ explanation: "Because, revised." })
      .where(eq(schema.quizQuestions.id, drifting));
  });

  afterAll(async () => {
    for (const id of quizIds) {
      await db.delete(schema.quizzes).where(eq(schema.quizzes.id, id));
    }
  });

  const states = async (translationState?: TranslationState) => {
    const { rows } = await listQuizzesForAdmin(
      parseListParams({ q: PREFIX, pageSize: "50" }, QUIZ_LIST_SPEC),
      { translationLocale: "ar", translationState },
    );
    return Object.fromEntries(
      rows.map((row) => [
        row.slug.replace(`${PREFIX}-q-`, ""),
        row.translation,
      ]),
    );
  };

  it("reports the worst part of each quiz", async () => {
    expect(await states()).toEqual({
      untranslated: "missing",
      complete: "published",
      "half-done": "missing",
      "gone-stale": "stale",
    });
  });

  it("narrows to what is missing, and counts what it lists", async () => {
    const { rows, total } = await listQuizzesForAdmin(
      parseListParams({ q: PREFIX, pageSize: "50" }, QUIZ_LIST_SPEC),
      { translationLocale: "ar", translationState: "missing" },
    );
    expect(
      rows.map((row) => row.slug.replace(`${PREFIX}-q-`, "")).sort(),
    ).toEqual(["half-done", "untranslated"]);
    expect(total).toBe(rows.length);
  });

  it("leaves the column out when no locale is asked about", async () => {
    const { rows } = await listQuizzesForAdmin(
      parseListParams({ q: PREFIX, pageSize: "50" }, QUIZ_LIST_SPEC),
    );
    expect(rows.every((row) => row.translation === undefined)).toBe(true);
  });
});
