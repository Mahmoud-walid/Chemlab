import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import { uuidv7 } from "uuidv7";

import { connect, seedUrl, type SeedDatabase } from "@/db/seed/connect";
import * as schema from "@/db/schema";
import {
  applyBulkQuizzes,
  quizzesForBulk,
} from "@/db/queries/admin/bulk-quizzes";
import { isWritable, planBulk, refusedResult } from "@/lib/admin/bulk";
import { createQuiz, createUser } from "../factories";
import { quizPublishBlockers } from "@/lib/admin/quiz-schema";

/**
 * A bulk quiz action against real Postgres.
 *
 * The same criterion as the lesson suite — one transaction, one audit entry
 * per row, all of it or none of it — plus the two things that are quiz-shaped
 * and cannot be inherited from it:
 *
 * - The publish decision needs a per-row count of questions AND of questions
 *   nobody can answer, computed as correlated subqueries. Both are the kind of
 *   thing that returns a plausible zero when written wrong, so they are
 *   asserted directly rather than only through a refusal.
 * - Withdrawal must NOT strand a sitting. `getPaper` does not filter on the
 *   quiz's status, and a test is the only thing that keeps that true.
 */

let db: SeedDatabase;
let close: () => Promise<void>;

const ACTOR = `bulk-quiz-actor-${uuidv7()}`;
let ids: string[] = [];

async function quiz(
  name: string,
  overrides: Partial<{
    status: "draft" | "published" | "archived";
    questions: number;
    answerable: boolean;
  }> = {},
): Promise<string> {
  const { id } = await createQuiz(db, {
    slug: `bulkquiz-${uuidv7()}`,
    title: `Quiz ${name}`,
    description: "For the bulk tests.",
    status: overrides.status ?? "draft",
    // One answerable question by default: a quiz with none cannot be
    // published, and most of these tests are about publishing.
    questions: overrides.questions ?? 1,
    answerable: overrides.answerable ?? true,
  });
  ids.push(id);
  return id;
}

const auditFor = async (quizIds: string[]) =>
  db
    .select({
      targetId: schema.auditLog.targetId,
      action: schema.auditLog.action,
      after: schema.auditLog.after,
    })
    .from(schema.auditLog)
    .where(
      and(
        eq(schema.auditLog.actorId, ACTOR),
        inArray(schema.auditLog.targetId, quizIds),
      ),
    );

beforeAll(async () => {
  const url = seedUrl();
  if (!url) throw new Error("no database URL");
  ({ db, close } = connect(url));
  await createUser(db, { id: ACTOR, name: "Bulk quiz actor" });
});

afterAll(async () => {
  // The actor is deliberately NOT deleted — see the note in
  // `bulk-lessons.test.ts` and Q40 in docs/DEFERRED_QUESTIONS.md.
  //
  // Deleted by slug PREFIX rather than by collected id: a row left behind
  // fails the NEXT suite's seed verifier with a count that is off by one, and
  // a test that throws part-way never reaches its own cleanup list.
  await db
    .delete(schema.quizzes)
    .where(sql`${schema.quizzes.slug} like 'bulkquiz-%'`);
  await close?.();
});

beforeEach(() => {
  ids = [];
});

describe("quizzesForBulk", () => {
  it("counts each quiz's own questions, not every question in the table", async () => {
    // The correlated subquery is the part that goes wrong silently: drizzle
    // renders columns unqualified inside `sql`, so an unqualified "id" binds
    // to the INNER table and counts either zero or the whole table for every
    // row. Two quizzes with different counts is what tells them apart.
    const one = await quiz("one question", { questions: 1 });
    const three = await quiz("three questions", { questions: 3 });

    const rows = await quizzesForBulk([one, three]);
    const byId = new Map(rows.map((row) => [row.id, row]));

    expect(byId.get(one)?.questionCount).toBe(1);
    expect(byId.get(three)?.questionCount).toBe(3);
  });

  it("counts a question with no correct answer as unanswerable", async () => {
    const answerable = await quiz("answerable");
    const not = await quiz("unanswerable", { answerable: false });

    const rows = await quizzesForBulk([answerable, not]);
    const byId = new Map(rows.map((row) => [row.id, row]));

    expect(byId.get(answerable)?.unanswerableCount).toBe(0);
    // A quiz nobody can pass is worse than one nobody can start.
    expect(byId.get(not)?.unanswerableCount).toBe(1);
  });

  it("counts a question whose correct option was deleted as unanswerable", async () => {
    // The FK is nullable and `quiz_options` cascades from the question, not
    // the other way round — so a `correct_option_id` pointing at nothing is
    // reachable, and a count that only checked for null would miss it.
    const id = await quiz("orphaned answer");
    const [question] = await db
      .select({ id: schema.quizQuestions.id })
      .from(schema.quizQuestions)
      .where(eq(schema.quizQuestions.quizId, id));

    await db
      .delete(schema.quizOptions)
      .where(eq(schema.quizOptions.questionId, question!.id));

    expect((await quizzesForBulk([id]))[0]?.unanswerableCount).toBe(1);
  });
});

describe("applyBulkQuizzes", () => {
  it("writes one audit entry per row, marked as a batch", async () => {
    const a = await quiz("A");
    const b = await quiz("B");

    await applyBulkQuizzes(ACTOR, await quizzesForBulk([a, b]), "archive");

    const entries = await auditFor([a, b]);
    // One per row. "Somebody archived forty quizzes" is not an answer to
    // "who archived this quiz", and the log is read one row at a time.
    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.targetId).sort()).toEqual(
      [a, b].sort(),
    );
    for (const entry of entries) {
      expect(entry.action).toBe("quiz.archived");
      // So the log can tell a batch from forty deliberate single actions.
      expect(entry.after).toMatchObject({ bulk: true });
    }
  });

  it("sets publishedAt on the first publish and never moves it after", async () => {
    const id = await quiz("first");
    await applyBulkQuizzes(ACTOR, await quizzesForBulk([id]), "publish");

    const [first] = await quizzesForBulk([id]);
    expect(first?.publishedAt).toBeInstanceOf(Date);

    await applyBulkQuizzes(ACTOR, await quizzesForBulk([id]), "archive");
    await applyBulkQuizzes(ACTOR, await quizzesForBulk([id]), "publish");

    const [again] = await quizzesForBulk([id]);
    // `published_at` records when a quiz FIRST went live. Re-publishing must
    // not rewrite that — it is the only record of the original date, and an
    // attempt's `quiz_revision` is read against it.
    expect(again?.publishedAt?.getTime()).toBe(first?.publishedAt?.getTime());
  });

  it("withdraws by soft-deleting and archiving together", async () => {
    const id = await quiz("withdrawn", { status: "published" });
    await applyBulkQuizzes(ACTOR, await quizzesForBulk([id]), "withdraw");

    const [row] = await quizzesForBulk([id]);
    expect(row?.deletedAt).toBeInstanceOf(Date);
    expect(row?.status).toBe("archived");
  });

  it("leaves nothing behind when the transaction fails", async () => {
    const a = await quiz("kept");
    const b = await quiz("kept too");
    const rows = await quizzesForBulk([a, b]);

    // A row whose id is not a uuid fails the UPDATE mid-transaction. The
    // point is what the OTHER rows look like afterwards.
    await expect(
      applyBulkQuizzes(
        ACTOR,
        [...rows, { ...rows[0]!, id: "not-a-uuid" }],
        "archive",
      ),
    ).rejects.toThrow();

    const after = await quizzesForBulk([a, b]);
    expect(after.map((row) => row.status)).toEqual(["draft", "draft"]);
    // And no audit entry survives either — a log of work that was rolled back
    // is worse than no log.
    expect(await auditFor([a, b])).toHaveLength(0);
  });

  it("does not strand a sitting already in progress", async () => {
    // The decision recorded in `bulkQuizAction`: withdrawing stops NEW
    // sittings and lets a live one finish. `getPaper` joins `exam_attempts`
    // to `quizzes` without filtering on status or `deleted_at`, and this is
    // the test that keeps that true — adding such a filter would fail here
    // rather than in front of a candidate part-way through a paper.
    const id = await quiz("live sitting", { status: "published" });
    const candidate = `sitting-${uuidv7()}`;
    await createUser(db, { id: candidate, name: "Candidate" });

    const [attempt] = await db
      .insert(schema.examAttempts)
      .values({
        quizId: id,
        userId: candidate,
        attemptNumber: 1,
        seed: 1,
        quizRevision: new Date(),
        status: "in_progress",
      })
      .returning({ id: schema.examAttempts.id });

    await applyBulkQuizzes(ACTOR, await quizzesForBulk([id]), "withdraw");

    const [still] = await db
      .select({ status: schema.examAttempts.status })
      .from(schema.examAttempts)
      .where(eq(schema.examAttempts.id, attempt!.id));

    expect(still?.status).toBe("in_progress");
  });
});

describe("planning a batch", () => {
  it("refuses the whole batch for one quiz with no questions, naming it", async () => {
    const good = await quiz("publishable");
    const empty = await quiz("empty", { questions: 0 });

    const found = await quizzesForBulk([good, empty]);
    const plan = planBulk([good, empty], found, (row) => {
      const blockers = quizPublishBlockers(row);
      return blockers.length > 0 ? { refuse: blockers } : {};
    });

    expect(isWritable(plan)).toBe(false);
    expect(plan.refused).toHaveLength(1);
    expect(plan.refused[0]?.label).toBe("Quiz empty");
    // The same key the single-row path returns, so a bulk refusal and a
    // single refusal read identically to whoever is looking at them.
    expect(plan.refused[0]?.detail).toContain("noQuestions");

    // And nothing was written, which is the whole point of planning first.
    expect(refusedResult(plan).applied).toBe(0);
    expect((await quizzesForBulk([good]))[0]?.status).toBe("draft");
  });

  it("refuses a quiz whose question nobody can answer", async () => {
    // The blocker lessons have no equivalent of. A quiz with questions looks
    // publishable by every count the lesson path takes.
    const broken = await quiz("no right answer", { answerable: false });

    const found = await quizzesForBulk([broken]);
    const plan = planBulk([broken], found, (row) => {
      const blockers = quizPublishBlockers(row);
      return blockers.length > 0 ? { refuse: blockers } : {};
    });

    expect(isWritable(plan)).toBe(false);
    expect(plan.refused[0]?.detail).toContain("unanswerableQuestion");
  });

  it("counts a quiz already published as unchanged, not refused", async () => {
    const live = await quiz("live", { status: "published" });
    const draft = await quiz("draft");

    const found = await quizzesForBulk([live, draft]);
    const plan = planBulk([live, draft], found, (row) => {
      const blockers = quizPublishBlockers(row);
      if (blockers.length > 0) return { refuse: blockers };
      return { skip: row.status === "published" };
    });

    expect(plan.unchanged).toEqual([live]);
    expect(plan.apply).toEqual([draft]);
    expect(isWritable(plan)).toBe(true);
  });

  it("refuses a selected id the database no longer has", async () => {
    const kept = await quiz("kept");
    const vanished = uuidv7();

    const found = await quizzesForBulk([kept, vanished]);
    const plan = planBulk([kept, vanished], found, () => ({}));

    // Deleted by somebody else between the page render and the click.
    // Silently dropping it would let a stale selection quietly shrink the
    // action.
    expect(plan.refused.map((row) => row.id)).toEqual([vanished]);
    expect(isWritable(plan)).toBe(false);
  });
});
