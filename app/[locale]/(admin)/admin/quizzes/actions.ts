"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { uuidv7 } from "uuidv7";

import { getDb } from "@/db/client";
import { quizQuestions, quizTranslations, quizzes } from "@/db/schema/content";
import type { ContentStatus } from "@/db/schema/content";
import { auditLog } from "@/db/schema/rbac";
import { quizPublishCounts, isQuizSlugTaken } from "@/db/queries/admin/quizzes";
import { replaceQuizQuestions } from "@/db/queries/admin/save-questions";
import {
  quizEditSchema,
  quizPublishBlockers,
  questionListSchema,
  secondsFromMinutes,
  type QuizPublishBlocker,
  type QuestionInput,
} from "@/lib/admin/quiz-schema";
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
        .set({ title: values.title, description: values.description })
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

  revalidateQuiz(before.slug);
  return { ok: true, slug: before.slug };
}
