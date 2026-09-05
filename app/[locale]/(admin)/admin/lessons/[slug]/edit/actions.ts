"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";

import { getDb } from "@/db/client";
import { auditLog } from "@/db/schema/rbac";
import { lessons } from "@/db/schema/content";
import {
  editableLessonId,
  saveSections,
  type SectionInput,
} from "@/db/queries/admin/lesson-sections";
import { recordActivity } from "@/lib/activity/record";
import { requirePermission } from "@/lib/authz";
import { blocksSchema } from "@/lib/lessons/blocks";

/**
 * Saving a lesson body.
 *
 * The blocks arrive from a browser, so they are validated HERE before anything
 * else happens — the editor's own validation is a convenience for the person
 * typing, and this is the copy that decides. A block the schema rejects is a
 * block the renderer would drop, so accepting it would store content that
 * silently does not appear.
 */

export interface SaveBodyResult {
  ok: boolean;
  problem?: string;
  readingTimeSeconds?: number;
  revision?: number;
}

export async function saveLessonBody(
  slug: string,
  sections: SectionInput[],
): Promise<SaveBodyResult> {
  const actor = await requirePermission("lesson:update");

  const lessonId = await editableLessonId(slug);
  if (!lessonId) return { ok: false, problem: "That lesson does not exist." };

  for (const section of sections) {
    if (section.heading.trim() === "") {
      return { ok: false, problem: "Every section needs a heading." };
    }
    const parsed = blocksSchema.safeParse(section.blocks);
    if (!parsed.success) {
      // The message names the section rather than dumping the issue list: an
      // author needs to know where to look, not what Zod calls the problem.
      return {
        ok: false,
        problem: `The section “${section.heading}” contains something that cannot be saved.`,
      };
    }
  }

  const [before] = await getDb()
    .select({
      revision: lessons.revision,
      readingTimeSeconds: lessons.readingTimeSeconds,
    })
    .from(lessons)
    .where(eq(lessons.id, lessonId));

  const result = await saveSections(lessonId, sections);

  await getDb()
    .insert(auditLog)
    .values({
      actorId: actor.userId,
      action: "lesson.body_update",
      targetType: "lesson",
      targetId: lessonId,
      // The bodies themselves are not recorded: they are the largest thing in
      // the database and the audit log is never pruned. What matters later is
      // that the body changed, by whom, and which revision it became.
      before: before ?? null,
      after: {
        revision: result.revision,
        readingTimeSeconds: result.readingTimeSeconds,
        sections: result.sections,
      },
    });

  await recordActivity({
    verb: "admin.updated",
    objectType: "lesson",
    objectId: lessonId,
    metadata: { body: true, revision: result.revision },
  });

  // Both the editor and the public page: the lesson is prerendered, so without
  // this the reader keeps the old body until something else rebuilds it.
  revalidatePath(`/admin/lessons/${slug}/edit`);
  revalidatePath(`/lessons/${slug}`, "page");

  return {
    ok: true,
    readingTimeSeconds: result.readingTimeSeconds,
    revision: result.revision,
  };
}
