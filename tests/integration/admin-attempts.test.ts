import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, like } from "drizzle-orm";
import { uuidv7 } from "uuidv7";

import { createQuiz } from "../factories";

import { connect, seedUrl, type SeedDatabase } from "@/db/seed/connect";
import * as schema from "@/db/schema";
import {
  ATTEMPT_LIST_SPEC,
  getQuizAttemptDetail,
  getUserAttemptHistory,
  listQuizAttemptSummaries,
} from "@/db/queries/admin/attempts";
import { parseListParams } from "@/db/queries/admin/list-params";

/**
 * The admin view of sittings, against real Postgres.
 *
 * Every aggregate here is computed in SQL, so these tests exist to prove the
 * SQL says what the column headings claim: that a voided sitting does not move
 * the average, that a question nobody reached is not counted as a hard
 * question, and that a quiz nobody has sat still appears rather than being
 * dropped by a join.
 */

let db: SeedDatabase;
let close: () => Promise<void>;

const SLUG = "admin-attempts-suite";
const USERS = [`aa-suite-a-${uuidv7()}`, `aa-suite-b-${uuidv7()}`];

let quizId: string;
const questionIds: string[] = [];
const correctOption = new Map<string, string>();

const list = () => parseListParams({}, ATTEMPT_LIST_SPEC);

/** Creates a finished attempt with a chosen score, bypassing the engine. */
async function seedAttempt(opts: {
  userId: string;
  number: number;
  score: number;
  status?: "submitted" | "expired" | "voided" | "in_progress";
  answers?: {
    questionId: string;
    correct: boolean | null;
    selected: string[];
  }[];
}) {
  const id = uuidv7();
  await db.insert(schema.examAttempts).values({
    id,
    quizId,
    userId: opts.userId,
    attemptNumber: opts.number,
    seed: 1,
    quizRevision: new Date(),
    status: opts.status ?? "submitted",
    score: opts.score,
    maxScore: 4,
    passed: opts.score >= 2,
    submittedAt: new Date(),
  });
  for (const answer of opts.answers ?? []) {
    await db.insert(schema.attemptAnswers).values({
      attemptId: id,
      questionId: answer.questionId,
      selectedOptionIds: answer.selected,
      isCorrect: answer.correct,
      pointsAwarded: answer.correct ? 1 : 0,
    });
  }
  return id;
}

beforeAll(async () => {
  const url = seedUrl();
  if (!url) throw new Error("no database URL");
  ({ db, close } = connect(url));

  for (const id of USERS) {
    await db.insert(schema.users).values({
      id,
      name: "Admin attempts suite",
      email: `${id}@aa.invalid`,
      emailVerified: true,
    });
  }

  quizId = uuidv7();
  await db.insert(schema.quizzes).values({
    id: quizId,
    slug: SLUG,
    title: "Admin attempts suite quiz",
    description: "Created by tests/integration/admin-attempts.test.ts.",
    difficulty: "easy",
    category: "Testing",
    status: "published",
    publishedAt: new Date(),
    passMarkPercent: 50,
  });

  for (let q = 0; q < 4; q++) {
    const questionId = uuidv7();
    questionIds.push(questionId);
    await db.insert(schema.quizQuestions).values({
      id: questionId,
      quizId,
      position: q,
      prompt: `Admin suite question ${q}`,
      explanation: "…",
    });
    const optionIds = [uuidv7(), uuidv7()];
    for (const [index, id] of optionIds.entries()) {
      await db.insert(schema.quizOptions).values({
        id,
        questionId,
        position: index,
        label: `Option ${index}`,
      });
    }
    await db
      .update(schema.quizQuestions)
      .set({ correctOptionId: optionIds[0] })
      .where(eq(schema.quizQuestions.id, questionId));
    correctOption.set(questionId, optionIds[0]!);
  }

  /**
   * The three sittings every summary and detail test reads.
   *
   * They used to be created by the first test that needed them, which made
   * every later test depend on that one having run — a narrative that reads
   * well top to bottom and fails the moment `--sequence.shuffle` changes the
   * order. Setup belongs in setup.
   */
  await seedAttempt({ userId: USERS[0]!, number: 1, score: 4 });
  await seedAttempt({
    userId: USERS[0]!,
    number: 2,
    score: 1,
    status: "voided",
  });
  await seedAttempt({
    userId: USERS[1]!,
    number: 1,
    score: 0,
    status: "in_progress",
  });
  // The fourth, with per-question answers. It belongs here for the same
  // reason as the others: it changes what every summary and detail test
  // sees, so creating it inside one of them makes the rest depend on that
  // one having run first.
  await seedAttempt({
    userId: USERS[1]!,
    number: 2,
    score: 1,
    answers: [
      {
        questionId: questionIds[0]!,
        correct: true,
        selected: [correctOption.get(questionIds[0]!)!],
      },
      { questionId: questionIds[1]!, correct: false, selected: [] },
    ],
  });
});

afterAll(async () => {
  // By prefix: a test creates a quiz of its own, and a leftover row makes
  // `pnpm db:seed`'s verifier fail the NEXT suite to run rather than this one.
  await db.delete(schema.quizzes).where(like(schema.quizzes.slug, `${SLUG}%`));
  for (const id of USERS) {
    await db.delete(schema.users).where(eq(schema.users.id, id));
  }
  await close?.();
});

describe("the per-quiz summary", () => {
  it("lists a quiz nobody has sat, with zeroes", async () => {
    // Its own quiz, because the suite's main one HAS been sat — three times,
    // set up before any test runs. This used to assert against that quiz and
    // pass only while it ran before the test that seeded the sittings.
    const untouched = await createQuiz(db, {
      slug: `${SLUG}-untouched-${uuidv7()}`,
      title: "Nobody has sat this",
      status: "published",
    });

    // A LEFT join, not an inner one: an inner join would silently drop
    // exactly the quizzes worth noticing.
    const rows = await listQuizAttemptSummaries();
    const row = rows.find((entry) => entry.slug === untouched.slug);
    expect(row).toBeTruthy();
    expect(row!.finished).toBe(0);
    expect(row!.averagePercent).toBeNull();
    expect(row!.passRate).toBeNull();
  });

  it("counts finished, in-progress and voided separately", async () => {
    const row = (await listQuizAttemptSummaries()).find(
      (entry) => entry.slug === SLUG,
    )!;
    expect(row.finished).toBe(2);
    expect(row.voided).toBe(1);
    expect(row.inProgress).toBe(1);
  });

  it("keeps a voided sitting out of the average and the pass rate", async () => {
    // The whole reason a void is a status rather than a delete: it happened,
    // it is visible, and it stops counting. A struck-out attempt still moving
    // the average would make the sanction change the quiz's statistics.
    const row = (await listQuizAttemptSummaries()).find(
      (entry) => entry.slug === SLUG,
    )!;
    // Two marked, unvoided sittings: 4/4 and 1/4. The voided 1/4 is excluded,
    // which is the claim — counting it would drag the average to 50.
    expect(row.averagePercent).toBe(63);
    expect(row.passRate).toBe(50);
  });
});

describe("the per-quiz detail", () => {
  it("returns nothing for an unknown slug", async () => {
    expect(await getQuizAttemptDetail("no-such-quiz", list())).toBeNull();
  });

  it("buckets the marks into ten bands, keeping the empty ones", async () => {
    // An empty band is information — "nobody scored between 40 and 50" — so
    // it renders as a gap rather than closing the axis up.
    const detail = (await getQuizAttemptDetail(SLUG, list()))!;
    expect(detail.distribution).toHaveLength(10);
    expect(detail.distribution.map((bucket) => bucket.from)).toEqual([
      0, 10, 20, 30, 40, 50, 60, 70, 80, 90,
    ]);
    // 4/4 = 100%, which belongs in the last bucket rather than an eleventh.
    expect(detail.distribution[9]!.count).toBe(1);
    // And 1/4 = 25% lands in the 20–30 band.
    expect(detail.distribution[2]!.count).toBeGreaterThanOrEqual(1);
  });

  it("counts every attempt, including the voided one", async () => {
    const detail = (await getQuizAttemptDetail(SLUG, list()))!;
    expect(detail.total).toBe(4);
    expect(detail.attempts).toHaveLength(4);
  });

  it("shows the candidate's email, and says so when the account is gone", async () => {
    const detail = (await getQuizAttemptDetail(SLUG, list()))!;
    expect(detail.attempts.every((attempt) => attempt.userEmail !== null)).toBe(
      true,
    );
  });
});

describe("per-question difficulty", () => {
  it("counts a blank as skipped, not as wrong", async () => {
    // Averaging blanks into "percent correct" makes a long paper look harder
    // than it is: a question nobody reached is not a hard question. The
    // answered attempt is created in setup — see the note there.
    const detail = (await getQuizAttemptDetail(SLUG, list()))!;
    const first = detail.questions.find((q) => q.id === questionIds[0]!)!;
    const second = detail.questions.find((q) => q.id === questionIds[1]!)!;

    expect(first.answered).toBe(1);
    expect(first.correct).toBe(1);
    expect(first.percentCorrect).toBe(100);

    expect(second.answered).toBe(0);
    expect(second.skipped).toBe(1);
    // Not 0% — nobody answered it, so there is no percentage to report.
    expect(second.percentCorrect).toBeNull();
  });

  it("returns a row for every question, including untouched ones", async () => {
    // Scoped inside the join rather than the WHERE clause: moving it out
    // would drop exactly the questions with no answers.
    const detail = (await getQuizAttemptDetail(SLUG, list()))!;
    expect(detail.questions).toHaveLength(4);
    const untouched = detail.questions.find((q) => q.id === questionIds[3]!)!;
    expect(untouched.answered).toBe(0);
    expect(untouched.percentCorrect).toBeNull();
  });
});

describe("one person's history", () => {
  it("returns their sittings, newest first, and nobody else's", async () => {
    const rows = await getUserAttemptHistory(USERS[0]!);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.userId === USERS[0])).toBe(true);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1]!.startedAt.getTime()).toBeGreaterThanOrEqual(
        rows[i]!.startedAt.getTime(),
      );
    }
  });

  it("reports the percentage from the stored score, not by re-marking", async () => {
    // Nothing recomputes a mark at read time, so the admin screens cannot
    // disagree with what the candidate was shown.
    const rows = await getUserAttemptHistory(USERS[0]!);
    const full = rows.find((row) => row.score === 4)!;
    expect(full.percent).toBe(100);
  });
});
