import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";
import { uuidv7 } from "uuidv7";

import { connect, seedUrl, type SeedDatabase } from "@/db/seed/connect";
import * as schema from "@/db/schema";
import {
  getQuizForAdmin,
  isQuizSlugTaken,
  listQuizzesForAdmin,
  nextQuizPosition,
  quizPublishCounts,
  QUIZ_LIST_SPEC,
} from "@/db/queries/admin/quizzes";
import { replaceQuizQuestions } from "@/db/queries/admin/save-questions";
import { listQuizSlugs, listQuizzes } from "@/db/queries/quizzes";
import { getQuizIntro } from "@/db/queries/exams/attempts";
import { parseListParams } from "@/db/queries/admin/list-params";
import { quizPublishBlockers } from "@/lib/admin/quiz-schema";
import type { QuestionInput } from "@/lib/admin/quiz-schema";

/**
 * The quiz admin, against real Postgres.
 *
 * The question editor's save is the reason this file exists. It deletes,
 * inserts, reorders and repoints the answer inside one transaction, against a
 * unique index on (quiz_id, position) — every one of those can go wrong
 * silently, and none of them is visible from a unit test.
 */

let db: SeedDatabase;
let close: () => Promise<void>;

/** A quiz this suite owns, so no seeded row is left in a changed state. */
const OWNED = {
  id: uuidv7(),
  slug: "suite-owned-quiz",
  title: "A quiz the suite owns",
  description: "Created by tests/integration/admin-quizzes.test.ts.",
  difficulty: "easy" as const,
  category: "Testing",
};

beforeAll(async () => {
  const url = seedUrl();
  if (!url) throw new Error("no database URL");
  ({ db, close } = connect(url));
});

afterAll(async () => {
  await db.delete(schema.quizzes).where(eq(schema.quizzes.id, OWNED.id));
  await close?.();
});

beforeEach(async () => {
  // Rebuilt per test rather than shared: these tests rewrite its questions,
  // and a test that depends on what the previous one left behind is a test
  // that passes alone and fails in CI.
  await db.delete(schema.quizzes).where(eq(schema.quizzes.id, OWNED.id));
  await db
    .insert(schema.quizzes)
    .values({ ...OWNED, status: "draft", position: 9000 });
});

const defaultList = () => parseListParams({}, QUIZ_LIST_SPEC);

function question(overrides: Partial<QuestionInput> = {}): QuestionInput {
  return {
    prompt: "A prompt",
    explanation: "An explanation",
    points: 1,
    options: [{ label: "Right" }, { label: "Wrong" }],
    correctIndex: 0,
    ...overrides,
  };
}

/** The stored questions in position order, with their answers resolved. */
async function stored() {
  const quiz = await getQuizForAdmin(OWNED.slug);
  return quiz!.questions;
}

async function positionsOf(quizId: string) {
  const rows = await db
    .select({ position: schema.quizQuestions.position })
    .from(schema.quizQuestions)
    .where(eq(schema.quizQuestions.quizId, quizId))
    .orderBy(asc(schema.quizQuestions.position));
  return rows.map((row) => row.position);
}

describe("saving questions", () => {
  it("writes a new question with its options and answer", async () => {
    await db.transaction(async (tx) => {
      await replaceQuizQuestions(tx, OWNED.id, [
        question({ prompt: "What is the pH of water?" }),
      ]);
    });

    const questions = await stored();
    expect(questions).toHaveLength(1);
    expect(questions[0]!.prompt).toBe("What is the pH of water?");
    expect(questions[0]!.options.map((o) => o.label)).toEqual([
      "Right",
      "Wrong",
    ]);
    // Resolved from the stored reference, not assumed.
    expect(questions[0]!.correctIndex).toBe(0);
  });

  it("numbers questions contiguously from zero", async () => {
    await db.transaction(async (tx) => {
      await replaceQuizQuestions(tx, OWNED.id, [
        question({ prompt: "One" }),
        question({ prompt: "Two" }),
        question({ prompt: "Three" }),
      ]);
    });

    expect(await positionsOf(OWNED.id)).toEqual([0, 1, 2]);
  });

  it("reverses the order without tripping the unique index", async () => {
    // The reason positions are parked at negatives mid-transaction: assigning
    // 0,1,2 directly would collide with the rows that still hold them.
    await db.transaction(async (tx) => {
      await replaceQuizQuestions(tx, OWNED.id, [
        question({ prompt: "One" }),
        question({ prompt: "Two" }),
        question({ prompt: "Three" }),
      ]);
    });

    const before = await stored();
    const reversed = [...before].reverse().map((q) => ({
      id: q.id,
      prompt: q.prompt,
      explanation: q.explanation,
      points: q.points,
      options: q.options.map((o) => ({ id: o.id, label: o.label })),
      correctIndex: q.correctIndex,
    }));

    await db.transaction(async (tx) => {
      await replaceQuizQuestions(tx, OWNED.id, reversed);
    });

    const after = await stored();
    expect(after.map((q) => q.prompt)).toEqual(["Three", "Two", "One"]);
    expect(await positionsOf(OWNED.id)).toEqual([0, 1, 2]);
    // The same rows moved, not new ones: a reorder that recreated the rows
    // would orphan anything referencing them.
    expect(new Set(after.map((q) => q.id))).toEqual(
      new Set(before.map((q) => q.id)),
    );
  });

  it("keeps each answer pointing at its own option through a reorder", async () => {
    await db.transaction(async (tx) => {
      await replaceQuizQuestions(tx, OWNED.id, [
        question({
          prompt: "One",
          options: [{ label: "1a" }, { label: "1b" }],
          correctIndex: 1,
        }),
        question({
          prompt: "Two",
          options: [{ label: "2a" }, { label: "2b" }],
          correctIndex: 0,
        }),
      ]);
    });

    const before = await stored();
    const swapped = [before[1]!, before[0]!].map((q) => ({
      id: q.id,
      prompt: q.prompt,
      explanation: q.explanation,
      points: q.points,
      options: q.options.map((o) => ({ id: o.id, label: o.label })),
      correctIndex: q.correctIndex,
    }));

    await db.transaction(async (tx) => {
      await replaceQuizQuestions(tx, OWNED.id, swapped);
    });

    const after = await stored();
    expect(after[0]!.prompt).toBe("Two");
    expect(after[0]!.options[after[0]!.correctIndex]!.label).toBe("2a");
    expect(after[1]!.options[after[1]!.correctIndex]!.label).toBe("1b");
  });

  it("removes a question the author dropped, and its options with it", async () => {
    await db.transaction(async (tx) => {
      await replaceQuizQuestions(tx, OWNED.id, [
        question({ prompt: "Keep" }),
        question({ prompt: "Drop" }),
      ]);
    });

    const before = await stored();
    const dropped = before.find((q) => q.prompt === "Drop")!;

    await db.transaction(async (tx) => {
      await replaceQuizQuestions(tx, OWNED.id, [
        {
          id: before.find((q) => q.prompt === "Keep")!.id,
          prompt: "Keep",
          explanation: "An explanation",
          points: 1,
          options: [{ label: "Right" }, { label: "Wrong" }],
          correctIndex: 0,
        },
      ]);
    });

    expect((await stored()).map((q) => q.prompt)).toEqual(["Keep"]);

    // Cascaded, not orphaned.
    const orphans = await db
      .select({ id: schema.quizOptions.id })
      .from(schema.quizOptions)
      .where(eq(schema.quizOptions.questionId, dropped.id));
    expect(orphans).toEqual([]);
  });

  it("removes an option and leaves the answer on the right one", async () => {
    await db.transaction(async (tx) => {
      await replaceQuizQuestions(tx, OWNED.id, [
        question({
          options: [{ label: "A" }, { label: "B" }, { label: "C" }],
          correctIndex: 2,
        }),
      ]);
    });

    const before = (await stored())[0]!;
    // Drop the FIRST option; the answer was the third.
    await db.transaction(async (tx) => {
      await replaceQuizQuestions(tx, OWNED.id, [
        {
          id: before.id,
          prompt: before.prompt,
          explanation: before.explanation,
          points: before.points,
          options: before.options
            .slice(1)
            .map((o) => ({ id: o.id, label: o.label })),
          correctIndex: 1,
        },
      ]);
    });

    const after = (await stored())[0]!;
    expect(after.options.map((o) => o.label)).toEqual(["B", "C"]);
    expect(after.options[after.correctIndex]!.label).toBe("C");
  });

  it("clears every question when the author removes them all", async () => {
    await db.transaction(async (tx) => {
      await replaceQuizQuestions(tx, OWNED.id, [question(), question()]);
    });
    await db.transaction(async (tx) => {
      await replaceQuizQuestions(tx, OWNED.id, []);
    });

    expect(await stored()).toEqual([]);
    expect(await positionsOf(OWNED.id)).toEqual([]);
  });

  it("leaves the previous questions untouched when the transaction rolls back", async () => {
    await db.transaction(async (tx) => {
      await replaceQuizQuestions(tx, OWNED.id, [
        question({ prompt: "Original" }),
      ]);
    });

    await expect(
      db.transaction(async (tx) => {
        await replaceQuizQuestions(tx, OWNED.id, [
          question({ prompt: "Replacement" }),
        ]);
        throw new Error("something later failed");
      }),
    ).rejects.toThrow("something later failed");

    // Half a rewrite is worse than none: a quiz with the old answer key and
    // the new questions would mark correct answers wrong.
    expect((await stored()).map((q) => q.prompt)).toEqual(["Original"]);
  });
});

describe("publishing", () => {
  it("is refused for a quiz with no questions", async () => {
    const counts = await quizPublishCounts(OWNED.id);
    expect(counts.questionCount).toBe(0);
    const [quiz] = await db
      .select()
      .from(schema.quizzes)
      .where(eq(schema.quizzes.id, OWNED.id));
    expect(quizPublishBlockers({ ...quiz!, ...counts })).toEqual([
      "noQuestions",
    ]);
  });

  it("is refused when a question has no correct answer", async () => {
    await db.transaction(async (tx) => {
      await replaceQuizQuestions(tx, OWNED.id, [question()]);
    });
    // The FK is nullable, so this state is reachable by a hand-edited row.
    await db
      .update(schema.quizQuestions)
      .set({ correctOptionId: null })
      .where(eq(schema.quizQuestions.quizId, OWNED.id));

    const counts = await quizPublishCounts(OWNED.id);
    expect(counts.unanswerableCount).toBe(1);
  });

  it("counts an answer pointing at a deleted option as unanswerable", async () => {
    await db.transaction(async (tx) => {
      await replaceQuizQuestions(tx, OWNED.id, [question()]);
    });
    const stored0 = (await stored())[0]!;
    // `correct_option_id` is not a declared foreign key — it cannot be, the
    // reference is circular — so a dangling answer is possible and has to be
    // detected rather than prevented.
    await db
      .delete(schema.quizOptions)
      .where(eq(schema.quizOptions.id, stored0.options[0]!.id));

    expect((await quizPublishCounts(OWNED.id)).unanswerableCount).toBe(1);
  });

  it("is allowed for a complete quiz", async () => {
    await db.transaction(async (tx) => {
      await replaceQuizQuestions(tx, OWNED.id, [question(), question()]);
    });
    const counts = await quizPublishCounts(OWNED.id);
    const [quiz] = await db
      .select()
      .from(schema.quizzes)
      .where(eq(schema.quizzes.id, OWNED.id));
    expect(quizPublishBlockers({ ...quiz!, ...counts })).toEqual([]);
  });
});

describe("a draft quiz", () => {
  it("is invisible to the public catalogue and unreachable by slug", async () => {
    expect((await listQuizzes("en")).map((q) => q.slug)).not.toContain(
      OWNED.slug,
    );
    // `getQuizIntro` is what the public quiz page reads now; `getQuizBySlug`
    // is gone with the client-side runner that needed the answer key.
    expect(await getQuizIntro(OWNED.slug, "en")).toBeNull();
    expect(await listQuizSlugs()).not.toContain(OWNED.slug);
  });

  it("is visible in the admin list", async () => {
    const { rows } = await listQuizzesForAdmin(defaultList());
    expect(rows.map((row) => row.slug)).toContain(OWNED.slug);
  });

  it("is absent from the admin list filtered to published", async () => {
    const { rows } = await listQuizzesForAdmin(defaultList(), "published");
    expect(rows.map((row) => row.slug)).not.toContain(OWNED.slug);
  });
});

describe("the admin list", () => {
  it("orders by catalogue position", async () => {
    const { rows } = await listQuizzesForAdmin(defaultList());
    const positions = rows.map((row) => row.position);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("counts questions per quiz", async () => {
    const { rows } = await listQuizzesForAdmin({
      ...defaultList(),
      pageSize: 100,
    });
    const seeded = rows.find((row) => row.questionCount > 0);
    expect(seeded, "expected a seeded quiz with questions").toBeTruthy();
    expect(rows.find((row) => row.slug === OWNED.slug)?.questionCount).toBe(0);
  });

  it("hides soft-deleted quizzes, while the editor can still reach them", async () => {
    await db
      .update(schema.quizzes)
      .set({ deletedAt: new Date(), status: "archived" })
      .where(eq(schema.quizzes.id, OWNED.id));

    const { rows } = await listQuizzesForAdmin(defaultList());
    expect(rows.map((row) => row.slug)).not.toContain(OWNED.slug);
    expect(await getQuizForAdmin(OWNED.slug)).not.toBeNull();
  });
});

describe("slugs", () => {
  it("reports one held by another quiz, but not the quiz's own", async () => {
    expect(await isQuizSlugTaken(OWNED.slug)).toBe(true);
    expect(await isQuizSlugTaken(OWNED.slug, OWNED.id)).toBe(false);
  });

  it("is enforced by the database, not only by the check", async () => {
    await expect(
      db.insert(schema.quizzes).values({
        id: uuidv7(),
        slug: OWNED.slug,
        title: "A duplicate",
        description: "Should not be storable.",
        difficulty: "easy",
        category: "Testing",
      }),
    ).rejects.toThrow();
  });
});

describe("nextQuizPosition", () => {
  it("lands a new quiz after every existing one", async () => {
    const next = await nextQuizPosition();
    const { rows } = await listQuizzesForAdmin({
      ...defaultList(),
      pageSize: 100,
    });
    for (const row of rows) expect(next).toBeGreaterThan(row.position);
  });
});
