"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { uuidv7 } from "uuidv7";

import { getDb } from "@/db/client";
import { quizQuestions, quizTranslations, quizzes } from "@/db/schema/content";
import type { ContentStatus } from "@/db/schema/content";
import { auditLog } from "@/db/schema/rbac";
import { quizPublishCounts, isQuizSlugTaken } from "@/db/queries/admin/quizzes";
import {
  applyBulkQuizzes,
  quizzesForBulk,
  type BulkQuizAction,
} from "@/db/queries/admin/bulk-quizzes";
import {
  hardDeleteQuiz,
  quizHardDeleteState,
} from "@/db/queries/admin/hard-delete";
import { currentSourceHash } from "@/db/queries/translations";
import { replaceQuizQuestions } from "@/db/queries/admin/save-questions";
import {
  quizEditSchema,
  quizPublishBlockers,
  questionListSchema,
  secondsFromMinutes,
  type QuizPublishBlocker,
  type QuestionInput,
} from "@/lib/admin/quiz-schema";
import {
  isWritable,
  MAX_BULK_ROWS,
  planBulk,
  refusedResult,
  withinLimit,
  type BulkResult,
} from "@/lib/admin/bulk";
import {
  hardDeleteRefusals,
  type HardDeleteReason,
} from "@/lib/admin/hard-delete";
import { recordActivity } from "@/lib/activity/record";
import { requirePermission } from "@/lib/authz";

export interface QuizSaveResult {
  ok: boolean;
  slug?: string;
  /** Field-keyed messages, so the form can put each one where it belongs. */
  errors?: Record<string, string>;
  /** Reasons a lifecycle change was refused, as message keys. */
  blockers?: QuizPublishBlocker[];
  /** A problem that belongs to no field. */
  problem?: string;
}

export interface QuestionSaveResult {
  ok: boolean;
  /** Keyed "3.prompt" or "3.options.1.label", so the editor can place each. */
  errors?: Record<string, string>;
  problem?: string;
}

const UNIQUE_VIOLATION = "23505";

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === UNIQUE_VIOLATION
  );
}

function fieldErrors(issues: { path: PropertyKey[]; message: string }[]) {
  const errors: Record<string, string> = {};
  for (const issue of issues) {
    const key = issue.path.map(String).join(".");
    if (!errors[key]) errors[key] = issue.message;
  }
  return errors;
}

function readForm(formData: FormData) {
  return {
    slug: formData.get("slug"),
    title: formData.get("title"),
    description: formData.get("description"),
    difficulty: formData.get("difficulty"),
    category: formData.get("category"),
    position: formData.get("position"),
    timeLimitMinutes: formData.get("timeLimitMinutes"),
    passMarkPercent: formData.get("passMarkPercent"),
    maxAttempts: formData.get("maxAttempts"),
    shuffleQuestions: formData.get("shuffleQuestions"),
    shuffleOptions: formData.get("shuffleOptions"),
  };
}

function revalidateQuiz(slug: string, previousSlug?: string) {
  revalidatePath("/admin/quizzes");
  revalidatePath(`/admin/quizzes/${slug}`);
  revalidatePath("/quiz");
  revalidatePath(`/quiz/${slug}`);
  if (previousSlug && previousSlug !== slug) {
    revalidatePath(`/admin/quizzes/${previousSlug}`);
    revalidatePath(`/quiz/${previousSlug}`);
  }
  revalidatePath("/");
}

/** The columns the metadata form owns, with minutes converted to seconds. */
function storedFrom(input: ReturnType<typeof quizEditSchema.parse>) {
  const { timeLimitMinutes, ...rest } = input;
  return { ...rest, timeLimitSeconds: secondsFromMinutes(timeLimitMinutes) };
}

/**
 * Creates a quiz.
 *
 * Always a draft. A quiz is created empty, and #16 says a quiz with zero
 * questions cannot be published — so "create and publish" would be an action
 * whose only outcome is a refusal.
 */
export async function createQuiz(formData: FormData): Promise<QuizSaveResult> {
  const actor = await requirePermission("quiz:create");

  const parsed = quizEditSchema.safeParse(readForm(formData));
  if (!parsed.success) {
    return { ok: false, errors: fieldErrors(parsed.error.issues) };
  }

  if (await isQuizSlugTaken(parsed.data.slug)) {
    return { ok: false, errors: { slug: "That slug is already in use." } };
  }

  const db = getDb();
  const id = uuidv7();
  const values = storedFrom(parsed.data);

  try {
    await db.transaction(async (tx) => {
      await tx.insert(quizzes).values({ id, ...values, status: "draft" });

      // The default-locale translation row, so every read can join on locale
      // without special-casing the default. The seed does the same.
      await tx.insert(quizTranslations).values({
        quizId: id,
        locale: "en",
        title: values.title,
        description: values.description,
        // Published, not the column's `draft` default: this row IS the
        // English copy, not a translation waiting for review.
        status: "published",
        // Read back from the quiz written a line above, never recomputed
        // here — see db/queries/translations.ts.
        sourceHash: currentSourceHash(quizzes, id),
      });

      await tx.insert(auditLog).values({
        actorId: actor.userId,
        action: "quiz.create",
        targetType: "quiz",
        targetId: id,
        before: null,
        after: values,
      });
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, errors: { slug: "That slug is already in use." } };
    }
    throw error;
  }

  await recordActivity({
    verb: "admin.created",
    objectType: "quiz",
    objectId: id,
    metadata: { slug: values.slug, title: values.title },
  });

  revalidateQuiz(values.slug);
  return { ok: true, slug: values.slug };
}

/**
 * Saves a quiz's metadata and sitting rules.
 *
 * Questions are saved separately — they are a list with its own ordering, and
 * folding them into this form would mean one submit that can half-succeed.
 */
export async function updateQuiz(
  id: string,
  formData: FormData,
): Promise<QuizSaveResult> {
  const actor = await requirePermission("quiz:update");

  const parsed = quizEditSchema.safeParse(readForm(formData));
  if (!parsed.success) {
    return { ok: false, errors: fieldErrors(parsed.error.issues) };
  }

  const db = getDb();
  const [before] = await db
    .select()
    .from(quizzes)
    .where(eq(quizzes.id, id))
    .limit(1);
  if (!before) return { ok: false, problem: "That quiz does not exist." };

  if (await isQuizSlugTaken(parsed.data.slug, id)) {
    return { ok: false, errors: { slug: "That slug is already in use." } };
  }

  const values = storedFrom(parsed.data);

  try {
    await db.transaction(async (tx) => {
      await tx.update(quizzes).set(values).where(eq(quizzes.id, id));

      // The default-locale translation row tracks the base copy. Left stale it
      // would win the join and serve the OLD title to English readers, which
      // looks exactly like the save having failed.
      await tx
        .update(quizTranslations)
        .set({
          title: values.title,
          description: values.description,
          // The mirror row moves with the source, so English is never stale
          // against itself.
          sourceHash: currentSourceHash(quizzes, id),
        })
        .where(
          and(
            eq(quizTranslations.quizId, id),
            eq(quizTranslations.locale, "en"),
          ),
        );

      await tx.insert(auditLog).values({
        actorId: actor.userId,
        action: "quiz.update",
        targetType: "quiz",
        targetId: id,
        before,
        after: { ...before, ...values },
      });
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, errors: { slug: "That slug is already in use." } };
    }
    throw error;
  }

  await recordActivity({
    verb: "admin.updated",
    objectType: "quiz",
    objectId: id,
    metadata:
      before.slug === values.slug
        ? { slug: values.slug }
        : { slug: values.slug, previousSlug: before.slug },
  });

  revalidateQuiz(values.slug, before.slug);
  return { ok: true, slug: values.slug };
}

/**
 * Replaces a quiz's questions with the list the editor posts.
 *
 * The whole list at once, in one transaction, rather than an action per row.
 * Reordering, adding and deleting are one edit as far as the author is
 * concerned, and three actions would let a quiz end up half-reordered — with
 * a duplicate `position` the unique index would then refuse.
 *
 * Positions are rewritten to a contiguous 0..n-1 sequence from the list order.
 * Because (quiz_id, position) is unique, the rows are first parked at negative
 * positions: assigning the new numbers directly would collide with rows that
 * still hold them, and Postgres checks a plain unique index per statement, not
 * at commit.
 */
export async function saveQuizQuestions(
  quizId: string,
  questions: unknown,
): Promise<QuestionSaveResult> {
  const actor = await requirePermission("quiz:update");

  const parsed = questionListSchema.safeParse(questions);
  if (!parsed.success) {
    return { ok: false, errors: fieldErrors(parsed.error.issues) };
  }

  const db = getDb();
  const [quiz] = await db
    .select()
    .from(quizzes)
    .where(eq(quizzes.id, quizId))
    .limit(1);
  if (!quiz) return { ok: false, problem: "That quiz does not exist." };

  const incoming: QuestionInput[] = parsed.data;

  const before = await db
    .select({ id: quizQuestions.id })
    .from(quizQuestions)
    .where(eq(quizQuestions.quizId, quizId));

  await db.transaction(async (tx) => {
    // The SQL lives in db/queries/admin/save-questions.ts so it can be
    // exercised by a test that has a database but no request — the ordering
    // rewrite is the sharpest edge in this file.
    await replaceQuizQuestions(tx, quizId, incoming);

    await tx.insert(auditLog).values({
      actorId: actor.userId,
      action: "quiz.questions.replace",
      targetType: "quiz",
      targetId: quizId,
      before: { questionIds: before.map((row) => row.id) },
      after: { count: incoming.length },
    });
  });

  await recordActivity({
    verb: "admin.updated",
    objectType: "quiz",
    objectId: quizId,
    metadata: { slug: quiz.slug, questions: incoming.length },
  });

  revalidateQuiz(quiz.slug);
  return { ok: true };
}

/**
 * Moves a quiz through its lifecycle.
 *
 * Preconditions are checked HERE, against the stored rows — a client that
 * decides whether it may publish is not a check. `published_at` is written
 * once, the first time it goes live, and never cleared.
 */
export async function setQuizStatus(
  id: string,
  status: ContentStatus,
): Promise<QuizSaveResult> {
  const actor = await requirePermission("quiz:publish");

  const db = getDb();
  const [before] = await db
    .select()
    .from(quizzes)
    .where(eq(quizzes.id, id))
    .limit(1);
  if (!before) return { ok: false, problem: "That quiz does not exist." };

  if (status === "published") {
    const counts = await quizPublishCounts(id);
    const blockers = quizPublishBlockers({ ...before, ...counts });
    if (blockers.length > 0) return { ok: false, blockers };
  }

  await db.transaction(async (tx) => {
    await tx
      .update(quizzes)
      .set({
        status,
        publishedAt:
          status === "published" && before.publishedAt === null
            ? new Date()
            : before.publishedAt,
      })
      .where(eq(quizzes.id, id));

    await tx.insert(auditLog).values({
      actorId: actor.userId,
      action: `quiz.${status}`,
      targetType: "quiz",
      targetId: id,
      before: { status: before.status },
      after: { status },
    });
  });

  await recordActivity({
    verb: status === "published" ? "admin.published" : "admin.updated",
    objectType: "quiz",
    objectId: id,
    metadata: { slug: before.slug, from: before.status, to: status },
  });

  revalidateQuiz(before.slug);
  return { ok: true, slug: before.slug };
}

/**
 * Withdraws a quiz.
 *
 * A soft delete, always: attempts and results will reference these rows, and a
 * hard delete would take a student's history with it. The row keeps its slug,
 * so the URL cannot be reused for different content.
 */
export async function deleteQuiz(id: string): Promise<QuizSaveResult> {
  const actor = await requirePermission("quiz:delete");

  const db = getDb();
  const [before] = await db
    .select()
    .from(quizzes)
    .where(eq(quizzes.id, id))
    .limit(1);
  if (!before) return { ok: false, problem: "That quiz does not exist." };

  await db.transaction(async (tx) => {
    await tx
      .update(quizzes)
      .set({ deletedAt: new Date(), status: "archived" })
      .where(eq(quizzes.id, id));

    await tx.insert(auditLog).values({
      actorId: actor.userId,
      action: "quiz.delete",
      targetType: "quiz",
      targetId: id,
      before: { status: before.status, deletedAt: before.deletedAt },
      after: { status: "archived", deletedAt: new Date().toISOString() },
    });
  });

  await recordActivity({
    verb: "admin.deleted",
    objectType: "quiz",
    objectId: id,
    metadata: { slug: before.slug },
  });

  revalidateQuiz(before.slug);
  return { ok: true, slug: before.slug };
}

/** Brings a withdrawn quiz back as a draft, never straight to published. */
export async function restoreQuiz(id: string): Promise<QuizSaveResult> {
  const actor = await requirePermission("quiz:delete");

  const db = getDb();
  const [before] = await db
    .select()
    .from(quizzes)
    .where(eq(quizzes.id, id))
    .limit(1);
  if (!before) return { ok: false, problem: "That quiz does not exist." };

  await db.transaction(async (tx) => {
    await tx
      .update(quizzes)
      .set({ deletedAt: null, status: "draft" })
      .where(eq(quizzes.id, id));

    await tx.insert(auditLog).values({
      actorId: actor.userId,
      action: "quiz.restore",
      targetType: "quiz",
      targetId: id,
      before: { status: before.status, deletedAt: before.deletedAt },
      after: { status: "draft", deletedAt: null },
    });
  });

  await recordActivity({
    verb: "admin.updated",
    objectType: "quiz",
    objectId: id,
    metadata: { slug: before.slug, restored: true },
  });

  revalidateQuiz(before.slug);
  return { ok: true, slug: before.slug };
}

/* ------------------------------------------------------------- in bulk --- */

/**
 * One action, several quizzes, one transaction.
 *
 * The all-or-nothing rule is #64's, and the lesson twin of this function
 * argues it: a row that cannot take part **stops the whole batch** rather than
 * being skipped, because an operator who asks for forty rows and gets
 * thirty-seven has to work out which three from a list they can no longer see.
 *
 * What differs from lessons is the publish decision, and it is not cosmetic. A
 * quiz needs questions AND questions somebody can answer, so the blockers come
 * from `quizPublishBlockers` — the same function and therefore the same
 * message keys the single-row path uses. A batch refusal and a single refusal
 * read identically because they are literally the same keys.
 *
 * **Withdrawal does not refuse a quiz with a live sitting**, and that is a
 * decision rather than an omission. `getPaper` joins `exam_attempts` to
 * `quizzes` without filtering on status or `deleted_at` — only `startAttempt`
 * and the public quiz page require `published` — so a candidate part-way
 * through a paper can still finish it, submit it and be scored after the quiz
 * is withdrawn. Refusing the withdrawal would mean an operator cannot take a
 * broken quiz out of circulation until the last sitting drains, which is the
 * opposite of what withdrawing it is for. New sittings stop immediately, which
 * is the part that matters.
 */
export async function bulkQuizAction(
  ids: string[],
  action: BulkQuizAction,
): Promise<BulkResult> {
  // Once for the action, not once per row: these are not per-row rights.
  const actor = await requirePermission(
    action === "withdraw" ? "quiz:delete" : "quiz:publish",
  );

  if (ids.length === 0) {
    return {
      ok: false,
      applied: 0,
      unchanged: 0,
      refused: [],
      problem: "Nothing was selected.",
    };
  }

  // Checked on the SERVER because the browser can send whatever it likes, and
  // one transaction over ten thousand rows holds locks for as long as it takes.
  if (!withinLimit(ids)) {
    return {
      ok: false,
      applied: 0,
      unchanged: 0,
      refused: [],
      problem: `That is more than ${MAX_BULK_ROWS} quizzes at once.`,
    };
  }

  const found = await quizzesForBulk(ids);

  const plan = planBulk(ids, found, (row) => {
    if (action === "publish") {
      const blockers = quizPublishBlockers(row);
      if (blockers.length > 0) return { refuse: blockers };
      return { skip: row.status === "published" };
    }

    if (action === "archive") {
      // A withdrawn quiz is already out of sight; archiving it would change a
      // status nobody reads and hide that it is deleted.
      if (row.deletedAt !== null) return { refuse: ["deleted"] };
      return { skip: row.status === "archived" };
    }

    return { skip: row.deletedAt !== null };
  });

  if (!isWritable(plan)) return refusedResult(plan);

  const writing = found.filter((row) => plan.apply.includes(row.id));
  await applyBulkQuizzes(actor.userId, writing, action);

  for (const row of writing) {
    await recordActivity({
      verb: action === "withdraw" ? "admin.deleted" : "admin.published",
      objectType: "quiz",
      objectId: row.id,
      metadata: { slug: row.slug, bulk: true },
    });
    revalidateQuiz(row.slug);
  }

  return {
    ok: true,
    applied: plan.apply.length,
    unchanged: plan.unchanged.length,
    refused: [],
  };
}

/* --------------------------------------------------------- hard delete --- */

export interface QuizHardDeleteResult {
  ok: boolean;
  problem?: string;
  /** Reason KEYS, translated by the caller — never prose from a server action. */
  refusals?: HardDeleteReason[];
}

/**
 * Erases a quiz, rather than withdrawing it.
 *
 * Behind its own permission, which no role holds by default. Soft delete is
 * the default and stays the default — `deleteQuiz` above says why: attempts
 * and results reference these rows. This is the escape hatch for a quiz
 * created by mistake, and `hardDeleteRefusals` is what distinguishes a mistake
 * from a result.
 *
 * The refusals are checked here AND again inside the delete's own WHERE
 * clause. The state was read before an operator typed a confirmation, and
 * somebody else can publish the quiz in between — so the check that actually
 * decides is the one the transaction makes.
 */
export async function hardDeleteQuizAction(
  id: string,
): Promise<QuizHardDeleteResult> {
  const actor = await requirePermission("quiz:delete_hard");

  const row = await quizHardDeleteState(id);
  if (!row) return { ok: false, problem: "That quiz does not exist." };

  const refusals = hardDeleteRefusals(row);
  if (refusals.length > 0) return { ok: false, refusals };

  try {
    await hardDeleteQuiz(actor.userId, row);
  } catch {
    // The row changed between the check and the delete. Reported rather than
    // retried: whatever arrived is exactly the thing the operator should look
    // at before asking again.
    return {
      ok: false,
      problem: "The quiz changed before it could be deleted. Try again.",
    };
  }

  // No `recordActivity`: the activity stream is keyed on the object, and
  // writing an event about a quiz that no longer exists would put a row in the
  // stream that resolves to nothing. The audit entry is the record, and it
  // carries the slug and title precisely because the row is gone.

  revalidateQuiz(row.slug);
  return { ok: true };
}
