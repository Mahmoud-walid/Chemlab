"use server";

import { revalidatePath } from "next/cache";
import { eq, inArray, sql } from "drizzle-orm";
import { uuidv7 } from "uuidv7";

import { getDb } from "@/db/client";
import {
  lessonSections,
  lessons,
  lessonTranslations,
} from "@/db/schema/content";
import type { ContentStatus } from "@/db/schema/content";
import { auditLog } from "@/db/schema/rbac";
import { isSlugTaken } from "@/db/queries/admin/lessons";
import {
  applyBulkLessons,
  lessonsForBulk,
  type BulkLessonAction,
} from "@/db/queries/admin/bulk-lessons";
import {
  hardDeleteLesson,
  lessonHardDeleteState,
} from "@/db/queries/admin/hard-delete";
import {
  hardDeleteRefusals,
  type HardDeleteReason,
} from "@/lib/admin/hard-delete";
import { currentSourceHash } from "@/db/queries/translations";
import { localizedPaths } from "@/i18n/paths";
import {
  MAX_BULK_ROWS,
  isWritable,
  planBulk,
  refusedResult,
  withinLimit,
  type BulkResult,
} from "@/lib/admin/bulk";
import {
  lessonEditSchema,
  publishBlockers,
  type PublishBlocker,
} from "@/lib/admin/lesson-schema";
import { recordActivity } from "@/lib/activity/record";
import { emitNotificationEvent } from "@/lib/notifications/emit";
import { requirePermission } from "@/lib/authz";

export interface LessonSaveResult {
  ok: boolean;
  /** The slug to navigate to — it may have changed, or been created. */
  slug?: string;
  /** Field-keyed messages, so the form can put each one where it belongs. */
  errors?: Record<string, string>;
  /** Reasons a lifecycle change was refused, as message keys. */
  blockers?: PublishBlocker[];
  /** A problem that belongs to no field and is not a publish blocker. */
  problem?: string;
}

/** Postgres' unique-violation code, for turning a race into a field error. */
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
    const field = issue.path[0];
    if (typeof field === "string" && !errors[field])
      errors[field] = issue.message;
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
    coverImageUrl: formData.get("coverImageUrl"),
    references: formData.get("references"),
    tags: formData.get("tags"),
    position: formData.get("position"),
  };
}

/**
 * Revalidates everything an edit can be seen through.
 *
 * Both the admin screens and the public ones: an edit that is not revalidated
 * is an edit nobody sees until the next deploy, and a rename changes two
 * public URLs — the one that no longer exists and the one that now does.
 */
function revalidateLesson(slug: string, previousSlug?: string) {
  // Public paths go through `localizedPaths`, because under
  // `localePrefix: "as-needed"` the Arabic page is a separate cache entry at
  // a separate URL — and an English edit is exactly what changes it, whether
  // the Arabic falls back to this copy or is now out of date against it. See
  // i18n/paths.ts. The admin screens are not localised in the URL.
  const publicPaths = [
    ...localizedPaths("/lessons"),
    ...localizedPaths(`/lessons/${slug}`),
    ...localizedPaths("/"),
  ];

  revalidatePath("/admin/lessons");
  revalidatePath(`/admin/lessons/${slug}`);
  if (previousSlug && previousSlug !== slug) {
    revalidatePath(`/admin/lessons/${previousSlug}`);
    publicPaths.push(...localizedPaths(`/lessons/${previousSlug}`));
  }

  for (const path of publicPaths) revalidatePath(path);
}

/**
 * Creates a lesson.
 *
 * New lessons are always drafts. There is no "create and publish": the body
 * editor is a separate screen that does not exist yet, so a lesson is never
 * complete at the moment it is created, and publishing it here would put an
 * empty page on the public site.
 */
export async function createLesson(
  formData: FormData,
): Promise<LessonSaveResult> {
  const actor = await requirePermission("lesson:create");

  const parsed = lessonEditSchema.safeParse(readForm(formData));
  if (!parsed.success) {
    return { ok: false, errors: fieldErrors(parsed.error.issues) };
  }

  if (await isSlugTaken(parsed.data.slug)) {
    return { ok: false, errors: { slug: "That slug is already in use." } };
  }

  const db = getDb();

  // The id is generated here rather than read back from the insert: the schema
  // already generates v7 UUIDs in application code, so knowing it up front
  // costs nothing and saves a RETURNING round trip inside the transaction.
  const id = uuidv7();

  try {
    await db.transaction(async (tx) => {
      await tx.insert(lessons).values({ id, ...parsed.data, status: "draft" });

      // The default-locale translation row, so every read can join on locale
      // without special-casing the default. The seed does the same.
      await tx.insert(lessonTranslations).values({
        lessonId: id,
        locale: "en",
        title: parsed.data.title,
        description: parsed.data.description,
        // Published, not the column's `draft` default: this row IS the
        // English copy, not a translation waiting for review.
        status: "published",
        // Read back from the lesson written a line above, never recomputed
        // here — see db/queries/translations.ts.
        sourceHash: currentSourceHash(lessons, id),
      });

      // In the same transaction as the change it describes: a creation with no
      // record, or a record with no creation, are both worse than neither.
      await tx.insert(auditLog).values({
        actorId: actor.userId,
        action: "lesson.create",
        targetType: "lesson",
        targetId: id,
        before: null,
        after: parsed.data,
      });
    });
  } catch (error) {
    // Two authors submitting the same slug at once both pass the check above;
    // the unique index is what actually decides, so its refusal is reported as
    // the same field error rather than as a crash.
    if (isUniqueViolation(error)) {
      return { ok: false, errors: { slug: "That slug is already in use." } };
    }
    throw error;
  }

  await recordActivity({
    verb: "admin.created",
    objectType: "lesson",
    objectId: id,
    metadata: { slug: parsed.data.slug, title: parsed.data.title },
  });

  revalidateLesson(parsed.data.slug);
  return { ok: true, slug: parsed.data.slug };
}

/**
 * Saves a lesson's metadata.
 *
 * Metadata only. The body lives in `lesson_sections` and belongs to the rich
 * editor issue; this action never touches it, so a save from this form cannot
 * lose content it does not show.
 *
 * `requirePermission` is the FIRST statement, before the input is even read:
 * an unauthorised caller should not get as far as having their payload
 * validated, and a check further down is a check someone will move.
 */
export async function updateLesson(
  id: string,
  formData: FormData,
): Promise<LessonSaveResult> {
  const actor = await requirePermission("lesson:update");

  const parsed = lessonEditSchema.safeParse(readForm(formData));
  if (!parsed.success) {
    return { ok: false, errors: fieldErrors(parsed.error.issues) };
  }

  const db = getDb();

  const [before] = await db
    .select()
    .from(lessons)
    .where(eq(lessons.id, id))
    .limit(1);
  if (!before) return { ok: false, problem: "That lesson does not exist." };

  if (await isSlugTaken(parsed.data.slug, id)) {
    return { ok: false, errors: { slug: "That slug is already in use." } };
  }

  try {
    await db.transaction(async (tx) => {
      await tx.update(lessons).set(parsed.data).where(eq(lessons.id, id));

      // The default-locale translation row tracks the base copy. Left stale it
      // would win the join and serve the OLD title to English readers, which
      // looks exactly like the save having failed.
      await tx
        .update(lessonTranslations)
        .set({
          title: parsed.data.title,
          description: parsed.data.description,
          // The mirror row moves with the source, so English is never stale
          // against itself.
          sourceHash: currentSourceHash(lessons, id),
        })
        .where(
          sql`${lessonTranslations.lessonId} = ${id} and ${lessonTranslations.locale} = 'en'`,
        );

      await tx.insert(auditLog).values({
        actorId: actor.userId,
        action: "lesson.update",
        targetType: "lesson",
        targetId: id,
        before,
        after: { ...before, ...parsed.data },
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
    objectType: "lesson",
    objectId: id,
    // The rename is the part worth being able to find later: it changes a
    // public URL, and "why did this link stop working" is asked afterwards.
    metadata:
      before.slug === parsed.data.slug
        ? { slug: parsed.data.slug }
        : { slug: parsed.data.slug, previousSlug: before.slug },
  });

  revalidateLesson(parsed.data.slug, before.slug);
  return { ok: true, slug: parsed.data.slug };
}

/**
 * Moves a lesson through its lifecycle.
 *
 * Publishing is a distinct action rather than a field on the form, because it
 * is the one change with a consequence outside the admin panel — and because
 * it has preconditions a form field could not express. Those preconditions are
 * checked HERE, against the stored row, not against what the client sent: a
 * client that decides whether it may publish is not a check.
 *
 * `published_at` is written once, the first time a lesson goes live, and never
 * cleared. It records when the lesson was first published, which is what a
 * reader means by the date on an article; unpublishing and republishing does
 * not make it a new lesson.
 */
export async function setLessonStatus(
  id: string,
  status: ContentStatus,
): Promise<LessonSaveResult> {
  const actor = await requirePermission("lesson:publish");

  const db = getDb();

  const [before] = await db
    .select({
      id: lessons.id,
      slug: lessons.slug,
      title: lessons.title,
      description: lessons.description,
      category: lessons.category,
      status: lessons.status,
      publishedAt: lessons.publishedAt,
      deletedAt: lessons.deletedAt,
      // Qualified explicitly. Drizzle renders columns unqualified inside a
      // `sql` subquery, so `${lessonSections.lessonId} = ${lessons.id}` would
      // become `"lesson_id" = "id"` — and `"id"` binds to the INNER table,
      // silently counting zero for every lesson.
      sectionCount: sql<number>`(
        select count(*)::int from ${lessonSections}
        where ${lessonSections}."lesson_id" = ${lessons}."id"
      )`,
    })
    .from(lessons)
    .where(eq(lessons.id, id))
    .limit(1);

  if (!before) return { ok: false, problem: "That lesson does not exist." };

  if (status === "published") {
    const blockers = publishBlockers(before);
    if (blockers.length > 0) return { ok: false, blockers };
  }

  await db.transaction(async (tx) => {
    await tx
      .update(lessons)
      .set({
        status,
        publishedAt:
          status === "published" && before.publishedAt === null
            ? new Date()
            : before.publishedAt,
      })
      .where(eq(lessons.id, id));

    await tx.insert(auditLog).values({
      actorId: actor.userId,
      action: `lesson.${status}`,
      targetType: "lesson",
      targetId: id,
      before: { status: before.status },
      after: { status },
    });

    // Only on the transition INTO published, and only the first time: a
    // lesson archived and republished is not news, and re-announcing it is
    // how a category gets muted for ever.
    if (status === "published" && before.status !== "published") {
      // In the same transaction as the status change, so a rolled-back
      // publish cannot leave an announcement about a lesson nobody can read.
      await emitNotificationEvent(tx, {
        type: "lesson.published",
        actorId: actor.userId,
        subjectType: "lesson",
        subjectId: id,
        data: { lessonSlug: before.slug },
      });
    }
  });

  await recordActivity({
    verb: status === "published" ? "admin.published" : "admin.updated",
    objectType: "lesson",
    objectId: id,
    metadata: { slug: before.slug, from: before.status, to: status },
  });

  revalidateLesson(before.slug);
  return { ok: true, slug: before.slug };
}

/**
 * Withdraws a lesson.
 *
 * A soft delete, always. Lessons carry comments, likes and saves, and once
 * exam attempts reference them a hard delete would take a student's history
 * with it. The row keeps its slug too, so the URL cannot be reused for
 * different content.
 *
 * The status goes to `archived` in the same write: `deleted_at` alone would
 * leave a row that says "published" and is not, and every query would have to
 * remember to check both.
 */
export async function deleteLesson(id: string): Promise<LessonSaveResult> {
  const actor = await requirePermission("lesson:delete");

  const db = getDb();
  const [before] = await db
    .select()
    .from(lessons)
    .where(eq(lessons.id, id))
    .limit(1);
  if (!before) return { ok: false, problem: "That lesson does not exist." };

  await db.transaction(async (tx) => {
    await tx
      .update(lessons)
      .set({ deletedAt: new Date(), status: "archived" })
      .where(eq(lessons.id, id));

    await tx.insert(auditLog).values({
      actorId: actor.userId,
      action: "lesson.delete",
      targetType: "lesson",
      targetId: id,
      before: { status: before.status, deletedAt: before.deletedAt },
      after: { status: "archived", deletedAt: new Date().toISOString() },
    });
  });

  await recordActivity({
    verb: "admin.deleted",
    objectType: "lesson",
    objectId: id,
    metadata: { slug: before.slug },
  });

  revalidateLesson(before.slug);
  return { ok: true, slug: before.slug };
}

/** Brings a withdrawn lesson back as a draft, never straight to published. */
export async function restoreLesson(id: string): Promise<LessonSaveResult> {
  const actor = await requirePermission("lesson:delete");

  const db = getDb();
  const [before] = await db
    .select()
    .from(lessons)
    .where(eq(lessons.id, id))
    .limit(1);
  if (!before) return { ok: false, problem: "That lesson does not exist." };

  await db.transaction(async (tx) => {
    await tx
      .update(lessons)
      .set({ deletedAt: null, status: "draft" })
      .where(eq(lessons.id, id));

    await tx.insert(auditLog).values({
      actorId: actor.userId,
      action: "lesson.restore",
      targetType: "lesson",
      targetId: id,
      before: { status: before.status, deletedAt: before.deletedAt },
      after: { status: "draft", deletedAt: null },
    });
  });

  await recordActivity({
    verb: "admin.updated",
    objectType: "lesson",
    objectId: id,
    metadata: { slug: before.slug, restored: true },
  });

  revalidateLesson(before.slug);
  return { ok: true, slug: before.slug };
}

/* ------------------------------------------------------------- in bulk --- */

/**
 * One action, several lessons, one transaction.
 *
 * The all-or-nothing rule is #64's, and it is stricter than it first looks:
 * a row that cannot take part **stops the whole batch** rather than being
 * skipped. An operator who asks for forty rows and gets thirty-seven with a
 * toast has to work out which three, from a list they can no longer see.
 * Refusing and naming them lets them deselect and try again.
 *
 * A row already in the target state is not a refusal — see `lib/admin/bulk.ts`.
 *
 * Permissions are checked once for the action, not once per row: they are not
 * per-row rights. The cap is checked on the server because the browser can
 * send whatever it likes, and one transaction over ten thousand rows holds
 * locks for as long as it takes.
 */
export async function bulkLessonAction(
  ids: string[],
  action: BulkLessonAction,
): Promise<BulkResult> {
  // Once for the action, not once per row: these are not per-row rights.
  const actor = await requirePermission(
    action === "withdraw" ? "lesson:delete" : "lesson:publish",
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
      problem: `That is more than ${MAX_BULK_ROWS} lessons at once.`,
    };
  }

  const found = await lessonsForBulk(ids);

  const plan = planBulk(ids, found, (row) => {
    if (action === "publish") {
      // The same blockers the single-row path applies, returned as the same
      // keys, so a bulk refusal and a single refusal read identically.
      const blockers = publishBlockers(row);
      if (blockers.length > 0) return { refuse: blockers };
      return { skip: row.status === "published" };
    }

    if (action === "archive") {
      // A withdrawn lesson is already out of sight; archiving it would change
      // a status nobody reads and hide that it is deleted.
      if (row.deletedAt !== null) return { refuse: ["deleted"] };
      return { skip: row.status === "archived" };
    }

    return { skip: row.deletedAt !== null };
  });

  if (!isWritable(plan)) return refusedResult(plan);

  const writing = found.filter((row) => plan.apply.includes(row.id));
  await applyBulkLessons(actor.userId, writing, action);

  for (const row of writing) {
    await recordActivity({
      verb: action === "withdraw" ? "admin.deleted" : "admin.published",
      objectType: "lesson",
      objectId: row.id,
      metadata: { slug: row.slug, bulk: true },
    });
    revalidateLesson(row.slug);
  }

  return {
    ok: true,
    applied: plan.apply.length,
    unchanged: plan.unchanged.length,
    refused: [],
  };
}

/* --------------------------------------------------------- hard delete --- */

export interface HardDeleteResult {
  ok: boolean;
  problem?: string;
  /** Reason KEYS, translated by the caller — never prose from a server action. */
  refusals?: HardDeleteReason[];
}

/**
 * Erases a lesson, rather than withdrawing it.
 *
 * Behind its own permission, which no role holds by default. Soft delete is
 * the default and stays the default; this is the escape hatch for a row
 * created by mistake, and the refusals in `lib/admin/hard-delete.ts` are what
 * distinguish a mistake from history.
 *
 * The refusals are checked here AND again inside the delete's own WHERE
 * clause. The state was read before an operator typed a confirmation, and a
 * comment can arrive in between — so the check that actually decides is the
 * one the transaction makes.
 */
export async function hardDeleteLessonAction(
  id: string,
): Promise<HardDeleteResult> {
  const actor = await requirePermission("lesson:delete_hard");

  const row = await lessonHardDeleteState(id);
  if (!row) return { ok: false, problem: "That lesson does not exist." };

  const refusals = hardDeleteRefusals(row);
  if (refusals.length > 0) return { ok: false, refusals };

  try {
    await hardDeleteLesson(actor.userId, row);
  } catch {
    // The row changed between the check and the delete. Reported rather than
    // retried: whatever arrived is exactly the thing the operator should look
    // at before asking again.
    return {
      ok: false,
      problem: "The lesson changed before it could be deleted. Try again.",
    };
  }

  // No `recordActivity`: the activity stream is keyed on the object, and
  // writing an event about a lesson that no longer exists would put a row in
  // the stream that resolves to nothing. The audit entry is the record, and
  // it carries the slug and title precisely because the row is gone.

  revalidatePath("/admin/lessons");
  for (const path of localizedPaths("/lessons")) revalidatePath(path);
  for (const path of localizedPaths(`/lessons/${row.slug}`)) {
    revalidatePath(path);
  }

  return { ok: true };
}
