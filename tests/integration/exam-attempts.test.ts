import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { uuidv7 } from "uuidv7";

import { connect, seedUrl, type SeedDatabase } from "@/db/seed/connect";
import * as schema from "@/db/schema";
import {
  getPaper,
  isWithinDeadline,
  listAttempts,
  saveAnswer,
  startAttempt,
  submitAttempt,
  sweepExpiredAttempts,
} from "@/db/queries/exams/attempts";

/**
 * The exam engine, against real Postgres.
 *
 * These exist for the claims that cannot be checked by reading the code: that
 * the paper handed to a candidate carries no answer key, that the deadline is
 * the server's, and that the attempt cap survives two tabs pressing Start at
 * the same moment. The last one is a race, so it is asserted against the
 * database's unique index rather than against a count.
 */

let db: SeedDatabase;
let close: () => Promise<void>;

const SLUG = "engine-suite-quiz";
const USER = `engine-suite-${uuidv7()}`;

let quizId: string;
const questionIds: string[] = [];
/** questionId -> the id of its correct option. Read once, by the suite only. */
const answerKey = new Map<string, string>();
/** The text of one correct option, used to prove it never reaches a payload. */
let secretAnswerText = "";

beforeAll(async () => {
  const url = seedUrl();
  if (!url) throw new Error("no database URL");
  ({ db, close } = connect(url));

  await db.insert(schema.users).values({
    id: USER,
    name: "Engine Suite",
    email: `${USER}@engine.invalid`,
    emailVerified: true,
  });

  quizId = uuidv7();
  await db.insert(schema.quizzes).values({
    id: quizId,
    slug: SLUG,
    title: "Engine suite quiz",
    description: "Created by tests/integration/exam-attempts.test.ts.",
    difficulty: "easy",
    category: "Testing",
    status: "published",
    publishedAt: new Date(),
    timeLimitSeconds: 600,
    graceSeconds: 10,
    passMarkPercent: 50,
    maxAttempts: 2,
    shuffleQuestions: true,
    shuffleOptions: true,
  });

  for (let q = 0; q < 3; q++) {
    const questionId = uuidv7();
    questionIds.push(questionId);
    await db.insert(schema.quizQuestions).values({
      id: questionId,
      quizId,
      position: q,
      prompt: `Question ${q}`,
      explanation: `SECRET-EXPLANATION-${q}`,
      points: 1,
    });

    const optionIds = [uuidv7(), uuidv7(), uuidv7(), uuidv7()];
    for (const [index, optionId] of optionIds.entries()) {
      await db.insert(schema.quizOptions).values({
        id: optionId,
        questionId,
        position: index,
        label: index === 0 ? `SECRET-ANSWER-${q}` : `Distractor ${q}-${index}`,
      });
    }

    // Set through `correct_option_id`, which is what the admin editor writes.
    // The trigger added in 0010 is what makes `is_correct` follow — and that
    // is what scoring reads, so this also exercises the trigger.
    await db
      .update(schema.quizQuestions)
      .set({ correctOptionId: optionIds[0] })
      .where(eq(schema.quizQuestions.id, questionId));

    answerKey.set(questionId, optionIds[0]!);
  }
  secretAnswerText = "SECRET-ANSWER-0";
});

afterAll(async () => {
  await db.delete(schema.quizzes).where(eq(schema.quizzes.id, quizId));
  await db.delete(schema.users).where(eq(schema.users.id, USER));
  await close?.();
});

afterEach(async () => {
  await db
    .delete(schema.examAttempts)
    .where(eq(schema.examAttempts.userId, USER));
});

describe("the answer-key trigger", () => {
  it("marks the option named by correct_option_id, and only that one", async () => {
    // Two columns can express the same fact, so one of them will eventually be
    // wrong. The trigger is what stops that regardless of which code path did
    // the writing — an application convention would hold only until somebody
    // updates the row from a script.
    const rows = await db
      .select({
        id: schema.quizOptions.id,
        isCorrect: schema.quizOptions.isCorrect,
      })
      .from(schema.quizOptions)
      .where(eq(schema.quizOptions.questionId, questionIds[0]!));

    const correct = rows.filter((row) => row.isCorrect);
    expect(correct).toHaveLength(1);
    expect(correct[0]!.id).toBe(answerKey.get(questionIds[0]!));
  });

  it("moves the mark when the answer is changed", async () => {
    const rows = await db
      .select({ id: schema.quizOptions.id })
      .from(schema.quizOptions)
      .where(eq(schema.quizOptions.questionId, questionIds[2]!))
      .orderBy(schema.quizOptions.position);

    const original = answerKey.get(questionIds[2]!)!;
    await db
      .update(schema.quizQuestions)
      .set({ correctOptionId: rows[1]!.id })
      .where(eq(schema.quizQuestions.id, questionIds[2]!));

    const after = await db
      .select({
        id: schema.quizOptions.id,
        isCorrect: schema.quizOptions.isCorrect,
      })
      .from(schema.quizOptions)
      .where(eq(schema.quizOptions.questionId, questionIds[2]!));
    expect(after.filter((row) => row.isCorrect).map((row) => row.id)).toEqual([
      rows[1]!.id,
    ]);

    await db
      .update(schema.quizQuestions)
      .set({ correctOptionId: original })
      .where(eq(schema.quizQuestions.id, questionIds[2]!));
  });
});

describe("the paper handed to a candidate", () => {
  it("carries no explanation and no correct-answer marker, anywhere", async () => {
    // The central flaw of the implementation this replaces: it imported
    // data/quiz.json — every answer and explanation — into the browser bundle
    // before the candidate answered anything. Serialised whole rather than
    // field by field, so a key added later is caught too.
    const started = await startAttempt(SLUG, USER);
    expect(started.ok).toBe(true);
    const paper = await getPaper(
      (started as { attemptId: string }).attemptId,
      USER,
    );

    const payload = JSON.stringify(paper);
    expect(payload).not.toContain("SECRET-EXPLANATION");
    expect(payload).not.toContain("isCorrect");
    expect(payload).not.toContain("is_correct");
    expect(payload).not.toContain("correctOptionId");
    // The correct option's own text is present — it is an option, and has to
    // be — but nothing marks it out.
    expect(payload).toContain(secretAnswerText);
  });

  it("hands back every question and every option", async () => {
    const started = await startAttempt(SLUG, USER);
    const paper = await getPaper(
      (started as { attemptId: string }).attemptId,
      USER,
    );
    expect(paper!.questions).toHaveLength(3);
    for (const question of paper!.questions) {
      expect(question.options).toHaveLength(4);
    }
  });

  it("gives the same order on every read, so a refresh is not a reshuffle", async () => {
    // The seed is stored, not the permutation. Same seed, same paper, in any
    // process — which is what makes resume honest.
    const started = await startAttempt(SLUG, USER);
    const id = (started as { attemptId: string }).attemptId;
    const first = await getPaper(id, USER);
    const second = await getPaper(id, USER);
    expect(second!.questions.map((q) => q.id)).toEqual(
      first!.questions.map((q) => q.id),
    );
    expect(second!.questions[0]!.options.map((o) => o.id)).toEqual(
      first!.questions[0]!.options.map((o) => o.id),
    );
  });

  it("refuses to show one person's paper to another", async () => {
    // An attempt id is a UUID, but "unguessable" is not an authorization model.
    const started = await startAttempt(SLUG, USER);
    const id = (started as { attemptId: string }).attemptId;
    expect(await getPaper(id, "someone-else")).toBeNull();
  });

  it("reports the server's clock alongside the deadline", async () => {
    const started = await startAttempt(SLUG, USER);
    const paper = await getPaper(
      (started as { attemptId: string }).attemptId,
      USER,
    );
    expect(paper!.expiresAt).toBeInstanceOf(Date);
    expect(paper!.serverNow).toBeInstanceOf(Date);
    // Ten minutes, from the quiz's own limit — not from anything a client sent.
    const remaining = paper!.expiresAt!.getTime() - paper!.startedAt.getTime();
    expect(remaining).toBe(600_000);
  });
});

describe("starting", () => {
  it("stamps the deadline server-side from the quiz's limit", async () => {
    const started = await startAttempt(SLUG, USER);
    const [row] = await db
      .select()
      .from(schema.examAttempts)
      .where(
        eq(
          schema.examAttempts.id,
          (started as { attemptId: string }).attemptId,
        ),
      );
    expect(row!.expiresAt).not.toBeNull();
    expect(row!.expiresAt!.getTime() - row!.startedAt.getTime()).toBe(600_000);
  });

  it("resumes the live attempt instead of starting a second one", async () => {
    // Refusing would be defensible and unhelpful: the candidate who refreshed
    // would be told they have an attempt open and given no way to reach it.
    const first = await startAttempt(SLUG, USER);
    const second = await startAttempt(SLUG, USER);
    expect(second).toMatchObject({
      ok: true,
      resumed: true,
      attemptId: (first as { attemptId: string }).attemptId,
    });
  });

  it("cannot be raced past the one-live-attempt index", async () => {
    // Two tabs pressing Start together. A `select count(*)` before insert
    // loses this; the partial unique index does not.
    const results = await Promise.allSettled([
      db.insert(schema.examAttempts).values({
        id: uuidv7(),
        quizId,
        userId: USER,
        attemptNumber: 1,
        seed: 1,
        quizRevision: new Date(),
      }),
      db.insert(schema.examAttempts).values({
        id: uuidv7(),
        quizId,
        userId: USER,
        attemptNumber: 2,
        seed: 2,
        quizRevision: new Date(),
      }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  });

  it("numbers attempts consecutively", async () => {
    const first = await startAttempt(SLUG, USER);
    await submitAttempt((first as { attemptId: string }).attemptId, USER);
    const second = await startAttempt(SLUG, USER);
    const rows = await listAttempts(SLUG, USER);
    expect(rows.map((row) => row.attemptNumber).sort()).toEqual([1, 2]);
    expect(second.ok).toBe(true);
  });

  it("refuses once the attempt cap is reached", async () => {
    for (let i = 0; i < 2; i++) {
      const started = await startAttempt(SLUG, USER);
      await submitAttempt((started as { attemptId: string }).attemptId, USER);
    }
    expect(await startAttempt(SLUG, USER)).toMatchObject({
      ok: false,
      reason: "attempts_exhausted",
    });
  });

  it("counts a voided attempt against the cap", async () => {
    // Otherwise a void hands back an extra sitting, turning the sanction into
    // a reward.
    const started = await startAttempt(SLUG, USER);
    await db
      .update(schema.examAttempts)
      .set({ status: "voided", voidReason: "suite" })
      .where(
        eq(
          schema.examAttempts.id,
          (started as { attemptId: string }).attemptId,
        ),
      );

    const second = await startAttempt(SLUG, USER);
    await submitAttempt((second as { attemptId: string }).attemptId, USER);

    expect(await startAttempt(SLUG, USER)).toMatchObject({
      ok: false,
      reason: "attempts_exhausted",
    });
  });

  it("refuses a quiz that is not published", async () => {
    expect(await startAttempt("no-such-quiz", USER)).toMatchObject({
      ok: false,
      reason: "not_found",
    });
  });
});

describe("the deadline", () => {
  it("treats an untimed quiz as always in time", () => {
    expect(isWithinDeadline(null, 10, new Date("2099-01-01"))).toBe(true);
  });

  it("accepts a write inside the grace window after expiry", () => {
    // A grace period exists so an honest answer sent at T-1s is not lost to a
    // 400ms round trip.
    const expiresAt = new Date("2026-01-01T00:00:00Z");
    expect(
      isWithinDeadline(expiresAt, 10, new Date("2026-01-01T00:00:09Z")),
    ).toBe(true);
  });

  it("rejects a write past the grace window", () => {
    const expiresAt = new Date("2026-01-01T00:00:00Z");
    expect(
      isWithinDeadline(expiresAt, 10, new Date("2026-01-01T00:00:11Z")),
    ).toBe(false);
  });
});

describe("saving answers", () => {
  async function live() {
    const started = await startAttempt(SLUG, USER);
    return (started as { attemptId: string }).attemptId;
  }

  it("records a selection and hands it back on the next read", async () => {
    const attemptId = await live();
    const question = questionIds[0]!;
    const option = answerKey.get(question)!;

    expect(await saveAnswer(attemptId, USER, question, [option])).toEqual({
      ok: true,
    });

    const paper = await getPaper(attemptId, USER);
    const saved = paper!.questions.find((q) => q.id === question);
    expect(saved!.selectedOptionIds).toEqual([option]);
  });

  it("lets an answer be changed before submitting", async () => {
    const attemptId = await live();
    const question = questionIds[0]!;
    const options = await db
      .select({ id: schema.quizOptions.id })
      .from(schema.quizOptions)
      .where(eq(schema.quizOptions.questionId, question));

    await saveAnswer(attemptId, USER, question, [options[1]!.id]);
    await saveAnswer(attemptId, USER, question, [options[2]!.id]);

    const paper = await getPaper(attemptId, USER);
    expect(
      paper!.questions.find((q) => q.id === question)!.selectedOptionIds,
    ).toEqual([options[2]!.id]);
  });

  it("refuses an option that belongs to another question", async () => {
    // Without this an answer is recorded against a question it does not
    // belong to, and then scored.
    const attemptId = await live();
    const foreign = answerKey.get(questionIds[1]!)!;
    expect(
      await saveAnswer(attemptId, USER, questionIds[0]!, [foreign]),
    ).toEqual({
      ok: false,
      reason: "unknown_option",
    });
  });

  it("refuses a question from a different quiz", async () => {
    const attemptId = await live();
    const [other] = await db
      .select({ id: schema.quizQuestions.id })
      .from(schema.quizQuestions)
      .where(sql`${schema.quizQuestions.quizId} <> ${quizId}`)
      .limit(1);
    expect(await saveAnswer(attemptId, USER, other!.id, [])).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("refuses a save from somebody else", async () => {
    const attemptId = await live();
    expect(
      await saveAnswer(attemptId, "someone-else", questionIds[0]!, []),
    ).toMatchObject({ ok: false, reason: "not_found" });
  });

  it("rejects a late save and closes the attempt", async () => {
    // Late writes do not merely fail. Leaving the attempt in_progress would
    // keep the one-live-attempt index blocking the next sitting until
    // something else noticed.
    const attemptId = await live();
    await db
      .update(schema.examAttempts)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(schema.examAttempts.id, attemptId));

    expect(
      await saveAnswer(attemptId, USER, questionIds[0]!, [
        answerKey.get(questionIds[0]!)!,
      ]),
    ).toEqual({ ok: false, reason: "expired" });

    const [row] = await db
      .select({ status: schema.examAttempts.status })
      .from(schema.examAttempts)
      .where(eq(schema.examAttempts.id, attemptId));
    expect(row!.status).toBe("expired");
  });

  it("accepts a save inside the grace window", async () => {
    const attemptId = await live();
    // One second past a ten-second grace, not five: the margin is how long
    // this test may take to reach the assertion, and five seconds of slack
    // on a loaded CI runner is not enough — that is a flaky test, not a
    // strict one.
    await db
      .update(schema.examAttempts)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(schema.examAttempts.id, attemptId));

    expect(await saveAnswer(attemptId, USER, questionIds[0]!, [])).toEqual({
      ok: true,
    });
  });

  it("stores client-reported time without letting it near the score", async () => {
    const attemptId = await live();
    const question = questionIds[0]!;
    await saveAnswer(
      attemptId,
      USER,
      question,
      [answerKey.get(question)!],
      999_999,
    );

    const [row] = await db
      .select()
      .from(schema.attemptAnswers)
      .where(
        and(
          eq(schema.attemptAnswers.attemptId, attemptId),
          eq(schema.attemptAnswers.questionId, question),
        ),
      );
    expect(row!.timeSpentMs).toBe(999_999);
    // Not marked yet: nothing has been scored.
    expect(row!.isCorrect).toBeNull();
    expect(row!.pointsAwarded).toBeNull();
  });
});

describe("submitting", () => {
  it("scores from the database, not from anything the client said", async () => {
    const started = await startAttempt(SLUG, USER);
    const attemptId = (started as { attemptId: string }).attemptId;
    for (const question of questionIds) {
      await saveAnswer(attemptId, USER, question, [answerKey.get(question)!]);
    }

    const result = await submitAttempt(attemptId, USER);
    expect(result).toMatchObject({
      ok: true,
      score: 3,
      maxScore: 3,
      percent: 100,
      passed: true,
      expired: false,
    });
  });

  it("counts an unanswered question against the total", async () => {
    const started = await startAttempt(SLUG, USER);
    const attemptId = (started as { attemptId: string }).attemptId;
    await saveAnswer(attemptId, USER, questionIds[0]!, [
      answerKey.get(questionIds[0]!)!,
    ]);

    const result = await submitAttempt(attemptId, USER);
    expect(result).toMatchObject({
      score: 1,
      maxScore: 3,
      percent: 33,
      passed: false,
    });
  });

  it("writes the mark onto each answer row", async () => {
    const started = await startAttempt(SLUG, USER);
    const attemptId = (started as { attemptId: string }).attemptId;
    await saveAnswer(attemptId, USER, questionIds[0]!, [
      answerKey.get(questionIds[0]!)!,
    ]);
    const options = await db
      .select({ id: schema.quizOptions.id })
      .from(schema.quizOptions)
      .where(eq(schema.quizOptions.questionId, questionIds[1]!))
      .orderBy(schema.quizOptions.position);
    await saveAnswer(attemptId, USER, questionIds[1]!, [options[3]!.id]);

    await submitAttempt(attemptId, USER);

    const rows = await db
      .select()
      .from(schema.attemptAnswers)
      .where(eq(schema.attemptAnswers.attemptId, attemptId));
    const byQuestion = new Map(rows.map((row) => [row.questionId, row]));
    expect(byQuestion.get(questionIds[0]!)!.isCorrect).toBe(true);
    expect(byQuestion.get(questionIds[0]!)!.pointsAwarded).toBe(1);
    expect(byQuestion.get(questionIds[1]!)!.isCorrect).toBe(false);
    expect(byQuestion.get(questionIds[1]!)!.pointsAwarded).toBe(0);
  });

  it("refuses a second submit of the same attempt", async () => {
    const started = await startAttempt(SLUG, USER);
    const attemptId = (started as { attemptId: string }).attemptId;
    await submitAttempt(attemptId, USER);
    expect(await submitAttempt(attemptId, USER)).toMatchObject({
      ok: false,
      reason: "not_live",
    });
  });

  it("scores a late submit on what was saved, and marks it expired", async () => {
    // Discarding the work because the last click was two seconds late would
    // punish latency rather than time-keeping.
    const started = await startAttempt(SLUG, USER);
    const attemptId = (started as { attemptId: string }).attemptId;
    await saveAnswer(attemptId, USER, questionIds[0]!, [
      answerKey.get(questionIds[0]!)!,
    ]);
    await db
      .update(schema.examAttempts)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(schema.examAttempts.id, attemptId));

    const result = await submitAttempt(attemptId, USER);
    expect(result).toMatchObject({ ok: true, expired: true, score: 1 });

    const [row] = await db
      .select({ status: schema.examAttempts.status })
      .from(schema.examAttempts)
      .where(eq(schema.examAttempts.id, attemptId));
    expect(row!.status).toBe("expired");
  });

  it("refuses a submit from somebody else", async () => {
    const started = await startAttempt(SLUG, USER);
    expect(
      await submitAttempt(
        (started as { attemptId: string }).attemptId,
        "someone-else",
      ),
    ).toMatchObject({ ok: false, reason: "not_found" });
  });
});

describe("the expiry sweep", () => {
  it("closes an attempt nobody submitted, and scores what was saved", async () => {
    // Necessary rather than tidy-up: an attempt left in_progress by a closed
    // laptop blocks every future sitting through the one-live-attempt index,
    // and the client cannot release it — the whole case is that it is gone.
    const started = await startAttempt(SLUG, USER);
    const attemptId = (started as { attemptId: string }).attemptId;
    await saveAnswer(attemptId, USER, questionIds[0]!, [
      answerKey.get(questionIds[0]!)!,
    ]);
    await db
      .update(schema.examAttempts)
      .set({ expiresAt: new Date(Date.now() - 3_600_000) })
      .where(eq(schema.examAttempts.id, attemptId));

    expect(await sweepExpiredAttempts(quizId, USER)).toBe(1);

    const [row] = await db
      .select()
      .from(schema.examAttempts)
      .where(eq(schema.examAttempts.id, attemptId));
    expect(row!.status).toBe("expired");
    expect(row!.score).toBe(1);
    expect(row!.maxScore).toBe(3);
  });

  it("leaves an attempt still inside its grace window alone", async () => {
    const started = await startAttempt(SLUG, USER);
    // One second past a ten-second grace — see the note on the save test.
    await db
      .update(schema.examAttempts)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(
        eq(
          schema.examAttempts.id,
          (started as { attemptId: string }).attemptId,
        ),
      );

    expect(await sweepExpiredAttempts(quizId, USER)).toBe(0);
  });

  it("frees the slot so the next sitting can start", async () => {
    const first = await startAttempt(SLUG, USER);
    await db
      .update(schema.examAttempts)
      .set({ expiresAt: new Date(Date.now() - 3_600_000) })
      .where(
        eq(schema.examAttempts.id, (first as { attemptId: string }).attemptId),
      );

    // `startAttempt` sweeps before it looks, so this is the path a real
    // candidate takes rather than a manual sweep followed by a start.
    const second = await startAttempt(SLUG, USER);
    expect(second).toMatchObject({ ok: true, resumed: false });
  });
});

describe("cooldown and multiple choice", () => {
  const OTHER_SLUG = "engine-suite-cooldown";
  let otherQuizId: string;
  let multiQuestionId: string;
  let multiCorrect: string[] = [];

  beforeAll(async () => {
    otherQuizId = uuidv7();
    await db.insert(schema.quizzes).values({
      id: otherQuizId,
      slug: OTHER_SLUG,
      title: "Engine suite cooldown quiz",
      description: "Created by tests/integration/exam-attempts.test.ts.",
      difficulty: "easy",
      category: "Testing",
      status: "published",
      publishedAt: new Date(),
      timeLimitSeconds: null,
      passMarkPercent: 50,
      cooldownMinutes: 30,
      shuffleQuestions: false,
      shuffleOptions: false,
    });

    multiQuestionId = uuidv7();
    await db.insert(schema.quizQuestions).values({
      id: multiQuestionId,
      quizId: otherQuizId,
      position: 0,
      type: "multiple_choice",
      prompt: "Which of these are halogens?",
      explanation: "SECRET-EXPLANATION-multi",
      points: 4,
      partialCredit: true,
    });

    const optionIds = [uuidv7(), uuidv7(), uuidv7(), uuidv7()];
    for (const [index, id] of optionIds.entries()) {
      await db.insert(schema.quizOptions).values({
        id,
        questionId: multiQuestionId,
        position: index,
        label: `Option ${index}`,
        // Multiple choice cannot express its answer as one id, so `is_correct`
        // is written directly and `correct_option_id` stays null. The trigger
        // does not touch these rows.
        isCorrect: index < 2,
      });
    }
    multiCorrect = optionIds.slice(0, 2);
  });

  afterAll(async () => {
    await db.delete(schema.quizzes).where(eq(schema.quizzes.id, otherQuizId));
  });

  afterEach(async () => {
    await db
      .delete(schema.examAttempts)
      .where(eq(schema.examAttempts.quizId, otherQuizId));
  });

  it("refuses a new sitting inside the cooldown, and says when it opens", async () => {
    const started = await startAttempt(OTHER_SLUG, USER);
    await submitAttempt((started as { attemptId: string }).attemptId, USER);

    const blocked = await startAttempt(OTHER_SLUG, USER);
    expect(blocked).toMatchObject({ ok: false, reason: "cooling_down" });
    // Telling somebody to come back later without saying when is the sort of
    // message that produces a support request.
    expect((blocked as { availableAt: Date }).availableAt).toBeInstanceOf(Date);
  });

  it("leaves an untimed quiz with no deadline at all", async () => {
    const started = await startAttempt(OTHER_SLUG, USER);
    const paper = await getPaper(
      (started as { attemptId: string }).attemptId,
      USER,
    );
    expect(paper!.expiresAt).toBeNull();
  });

  it("scores a multiple-choice question from is_correct, with partial credit", async () => {
    const started = await startAttempt(OTHER_SLUG, USER);
    const attemptId = (started as { attemptId: string }).attemptId;
    // One of two right, nothing wrong: half of four points.
    await saveAnswer(attemptId, USER, multiQuestionId, [multiCorrect[0]!]);

    expect(await submitAttempt(attemptId, USER)).toMatchObject({
      score: 2,
      maxScore: 4,
      percent: 50,
      passed: true,
    });
  });

  it("gives full marks for exactly the right set", async () => {
    const started = await startAttempt(OTHER_SLUG, USER);
    const attemptId = (started as { attemptId: string }).attemptId;
    await saveAnswer(attemptId, USER, multiQuestionId, multiCorrect);

    expect(await submitAttempt(attemptId, USER)).toMatchObject({
      score: 4,
      percent: 100,
    });
  });
});
