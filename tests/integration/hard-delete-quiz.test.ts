import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { uuidv7 } from "uuidv7";

import { connect, seedUrl, type SeedDatabase } from "@/db/seed/connect";
import * as schema from "@/db/schema";
import {
  hardDeleteQuiz,
  quizHardDeleteState,
} from "@/db/queries/admin/hard-delete";
import { hardDeleteRefusals } from "@/lib/admin/hard-delete";
import { createQuestion, createQuiz, createUser } from "../factories";
import { allPermissionNames } from "@/db/seed/rbac";

/**
 * Erasing a quiz, against real Postgres.
 *
 * The lesson suite proves the shared shape. What is only true here:
 *
 * - An ATTEMPT is the reason this path exists. `exam_attempts` cascades from
 *   the quiz, so erasing one would take somebody's result with it — which is
 *   exactly what "a result is history, not a mistake" means in DDL.
 * - The cascade is a subtree: questions, options and both translation tables
 *   go too. The audit entry records how many questions, because "a quiz" is
 *   an understatement of what was erased.
 */

let db: SeedDatabase;
let close: () => Promise<void>;

const ACTOR = `hardq-actor-${uuidv7()}`;
const CANDIDATE = `hardq-candidate-${uuidv7()}`;

let quizId: string;
let slug: string;

beforeAll(async () => {
  const url = seedUrl();
  if (!url) throw new Error("no database URL");
  ({ db, close } = connect(url));

  await createUser(db, { id: ACTOR, name: "Eraser" });
  await createUser(db, { id: CANDIDATE, name: "Candidate" });
});

afterAll(async () => {
  await db
    .delete(schema.quizzes)
    .where(sql`${schema.quizzes.slug} like 'hardqdel-%'`);
  // The actors are left behind deliberately — see Q40: a user who has audited
  // anything cannot be deleted.
  await close?.();
});

beforeEach(async () => {
  const quiz = await createQuiz(db, {
    slug: `hardqdel-${uuidv7()}`,
    title: "A mistake",
    description: "Made while learning the editor.",
  });
  quizId = quiz.id;
  slug = quiz.slug;
});

const auditEntries = async () =>
  db
    .select({
      action: schema.auditLog.action,
      targetId: schema.auditLog.targetId,
      before: schema.auditLog.before,
    })
    .from(schema.auditLog)
    .where(
      and(
        eq(schema.auditLog.targetId, quizId),
        eq(schema.auditLog.action, "quiz.delete_hard"),
      ),
    );

const startAttempt = () =>
  db.insert(schema.examAttempts).values({
    quizId,
    userId: CANDIDATE,
    attemptNumber: 1,
    seed: 1,
    quizRevision: new Date(),
    status: "in_progress",
  });

describe("the permission", () => {
  it("exists in the catalogue and is held by no role", async () => {
    expect(allPermissionNames()).toContain("quiz:delete_hard");

    const rows = await db.execute<{ key: string }>(sql`
      select r.key
      from roles r
      join role_permissions rp on rp.role_id = r.id
      join permissions p on p.id = rp.permission_id
      where p.name = 'quiz:delete_hard'
    `);

    // Not even Admin. A Super Admin can grant it at runtime when somebody
    // genuinely needs it; nobody holds it by default.
    expect(rows.rows).toEqual([]);
  });
});

describe("what may be erased", () => {
  it("allows a draft nothing refers to", async () => {
    expect(hardDeleteRefusals((await quizHardDeleteState(quizId))!)).toEqual(
      [],
    );
  });

  it("refuses a quiz that was published and then withdrawn", async () => {
    await db
      .update(schema.quizzes)
      .set({
        status: "archived",
        publishedAt: new Date(),
        deletedAt: new Date(),
      })
      .where(eq(schema.quizzes.id, quizId));

    // `published_at` survives a withdrawal, and it is the only thing that
    // remembers candidates once saw this paper.
    expect(hardDeleteRefusals((await quizHardDeleteState(quizId))!)).toEqual([
      "wasPublished",
    ]);
  });

  it("counts an attempt, even one still in progress", async () => {
    await startAttempt();

    // An abandoned sitting is still somebody having seen the paper.
    expect(hardDeleteRefusals((await quizHardDeleteState(quizId))!)).toEqual([
      "hasAttempts",
    ]);
  });

  it("counts a submitted attempt too", async () => {
    await db.insert(schema.examAttempts).values({
      quizId,
      userId: CANDIDATE,
      attemptNumber: 1,
      seed: 1,
      quizRevision: new Date(),
      status: "submitted",
      submittedAt: new Date(),
      score: 1,
      maxScore: 1,
      passed: true,
    });

    expect(hardDeleteRefusals((await quizHardDeleteState(quizId))!)).toEqual([
      "hasAttempts",
    ]);
  });

  it("counts an activity event", async () => {
    await db.execute(sql`
      insert into activity_events (id, verb, object_type, object_id, created_at)
      values (gen_random_uuid(), 'admin.published'::activity_verb,
              'quiz'::activity_object_type, ${quizId}, now())
    `);

    // The activity stream is an audit surface. Erasing the row it points at
    // would leave an event that resolves to nothing.
    expect(hardDeleteRefusals((await quizHardDeleteState(quizId))!)).toEqual([
      "hasActivity",
    ]);
  });

  it("reports every reason at once, not the first", async () => {
    await db
      .update(schema.quizzes)
      .set({ status: "published", publishedAt: new Date() })
      .where(eq(schema.quizzes.id, quizId));
    await startAttempt();

    // An operator who clears one blocker and is then told about the next has
    // been made to discover the rules one round trip at a time.
    expect(hardDeleteRefusals((await quizHardDeleteState(quizId))!)).toEqual([
      "published",
      "wasPublished",
      "hasAttempts",
    ]);
  });

  it("never reports comments or engagement, because a quiz can have neither", async () => {
    // Not an unchecked reason: `comment_subject` is a Postgres enum whose only
    // value is 'lesson', and every engagement table holds a `lesson_id`. The
    // literal zeroes in `quizHardDeleteState` say so, and this is the test
    // that would fail if quizzes ever became commentable without the count
    // being made real.
    const state = await quizHardDeleteState(quizId);
    expect(state?.comments).toBe(0);
    expect(state?.engagement).toBe(0);

    await expect(
      db.execute(sql`
        insert into comments (id, subject_type, subject_id, author_id, body)
        values (gen_random_uuid(), 'quiz', ${quizId}, ${CANDIDATE}, 'hello')
      `),
    ).rejects.toThrow();
  });
});

describe("erasing", () => {
  it("removes the row and leaves the audit entry behind", async () => {
    await createQuestion(db, quizId, { position: 1 });
    await createQuestion(db, quizId, { position: 2 });

    await hardDeleteQuiz(ACTOR, (await quizHardDeleteState(quizId))!);

    expect(await quizHardDeleteState(quizId)).toBeNull();

    // `audit_log` holds no foreign key to the row, so the entry outlives it —
    // and carries the slug, title and how many questions went with it,
    // because an id pointing at nothing is not an answer to "what was
    // deleted" and "a quiz" understates a subtree.
    const entries = await auditEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.before).toMatchObject({
      slug,
      title: "A mistake",
      status: "draft",
      publishedAt: null,
      questionCount: 2,
    });
  });

  it("takes the quiz's own questions, options and translations with it", async () => {
    const { id: questionId } = await createQuestion(db, quizId, {
      answerable: true,
    });
    await db.insert(schema.quizTranslations).values({
      quizId,
      locale: "ar",
      title: "عنوان",
      description: "وصف",
      sourceHash: "whatever",
    });

    await hardDeleteQuiz(ACTOR, (await quizHardDeleteState(quizId))!);

    // Owned content, not references: none of these can outlive the quiz, and
    // the foreign key cascades are what say so.
    const questions = await db
      .select({ id: schema.quizQuestions.id })
      .from(schema.quizQuestions)
      .where(eq(schema.quizQuestions.id, questionId));
    expect(questions).toEqual([]);

    const options = await db
      .select({ id: schema.quizOptions.id })
      .from(schema.quizOptions)
      .where(eq(schema.quizOptions.questionId, questionId));
    expect(options).toEqual([]);

    const translations = await db
      .select({ id: schema.quizTranslations.id })
      .from(schema.quizTranslations)
      .where(eq(schema.quizTranslations.quizId, quizId));
    expect(translations).toEqual([]);
  });

  it("refuses to erase a row that was published after the check", async () => {
    const state = await quizHardDeleteState(quizId);

    // The window this guards: the state was read before an operator typed a
    // confirmation, and the quiz went live in between. Which matters more
    // here than for a lesson — once it is live it can be sat, and the sitting
    // would cascade away with it.
    await db
      .update(schema.quizzes)
      .set({ status: "published", publishedAt: new Date() })
      .where(eq(schema.quizzes.id, quizId));

    await expect(hardDeleteQuiz(ACTOR, state!)).rejects.toThrow();

    // Still there — and no audit entry claiming otherwise. A log saying a
    // quiz was erased when it was not is worse than no log.
    expect(await quizHardDeleteState(quizId)).not.toBeNull();
    expect(await auditEntries()).toHaveLength(0);
  });
});
