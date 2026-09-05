"use server";

import { revalidatePath } from "next/cache";

import { getDb } from "@/db/client";
import { auditLog } from "@/db/schema/rbac";
import {
  claimTranslator,
  getLessonTranslation,
  saveLessonTranslation,
  setLessonTranslationStatus,
} from "@/db/queries/admin/translations";
import { editableLessonId } from "@/db/queries/admin/lesson-sections";
import { recordActivity } from "@/lib/activity/record";
import { requirePermission } from "@/lib/authz";
import { blocksSchema } from "@/lib/lessons/blocks";
import { applyTranslations } from "@/lib/translations/blocks";
import { isSupportedLocale, defaultLocale } from "@/i18n/routing";
import { localizedPaths } from "@/i18n/paths";

/**
 * Writing and signing off a translation.
 *
 * Two permissions, deliberately, and the split is the point of the feature:
 * `translation:write` writes words, `translation:review` decides they are
 * good enough for a reader. The `editor` role holds the first and not the
 * second, so nobody publishes their own chemistry translation unchecked.
 *
 * Neither action trusts the browser for structure. The blocks that get stored
 * are built HERE, from the source rows, with only the words substituted — see
 * `lib/translations/blocks.ts`. A posted block array is not accepted at all,
 * so there is no path by which a translation can gain, lose or reorder a
 * block relative to its source.
 */

export interface TranslationSaveResult {
  ok: boolean;
  problem?: string;
}

/** Neither the default locale nor anything the router does not know. */
function targetLocale(locale: string): string | null {
  if (!isSupportedLocale(locale)) return null;
  // Translating the default locale into itself is not a thing to allow: the
  // `en` row mirrors the source and is maintained by the lesson's own save.
  return locale === defaultLocale ? null : locale;
}

export async function saveTranslation(
  slug: string,
  locale: string,
  values: Record<string, string>,
  fields: {
    title: string;
    description: string;
    headings: Record<string, string>;
  },
): Promise<TranslationSaveResult> {
  const actor = await requirePermission("translation:write");

  const target = targetLocale(locale);
  if (!target)
    return { ok: false, problem: "That is not a locale to translate into." };

  const lessonId = await editableLessonId(slug);
  if (!lessonId) return { ok: false, problem: "That lesson does not exist." };

  // Re-read the source rather than trusting what the form was rendered from.
  // A source edited while somebody had the form open must not be overwritten
  // by a translation built against the older structure.
  const view = await getLessonTranslation(slug, target);
  if (!view) return { ok: false, problem: "That lesson does not exist." };

  if (fields.title.trim() === "") {
    return { ok: false, problem: "A translation needs a title." };
  }

  const sections = view.sections.map((section) => ({
    id: section.id,
    heading: fields.headings[section.id]?.trim()
      ? fields.headings[section.id]!
      : section.heading,
    blocks: applyTranslations(section.blocks, values),
  }));

  // Validated even though it was built here: `applyTranslations` substitutes
  // text a person typed, and a schema that rejects it would reject it at read
  // time instead — at which point the section renders as nothing.
  for (const section of sections) {
    if (!blocksSchema.safeParse(section.blocks).success) {
      return {
        ok: false,
        problem: `The section “${section.heading}” contains something that cannot be saved.`,
      };
    }
  }

  await saveLessonTranslation(lessonId, target, {
    title: fields.title,
    description: fields.description,
    sections,
  });
  await claimTranslator(lessonId, target, actor.userId);

  await getDb()
    .insert(auditLog)
    .values({
      actorId: actor.userId,
      action: "translation.update",
      targetType: "lesson",
      targetId: lessonId,
      // The text itself is not recorded. It is the largest thing in the
      // database and the audit log is never pruned; what matters later is
      // that the translation changed, into what language, and by whom.
      before: { locale: target, status: view.translation?.status ?? null },
      after: { locale: target, sections: sections.length },
    });

  await recordActivity({
    verb: "admin.updated",
    objectType: "lesson",
    objectId: lessonId,
    metadata: { translation: target },
  });

  revalidatePath(`/admin/lessons/${slug}/translate`);
  revalidatePath(`/admin/lessons`);
  // Every locale's copy of the reader page, not just the default one. Under
  // `localePrefix: "as-needed"` the Arabic page is a different cache entry at
  // a different URL — see i18n/paths.ts — and it is the one this change is
  // actually about.
  for (const path of localizedPaths(`/lessons/${slug}`)) {
    revalidatePath(path);
  }

  return { ok: true };
}

/**
 * Submitting for review needs only `translation:write` — asking somebody to
 * check your work is part of doing it. Publishing and sending back both need
 * `translation:review`.
 */
export async function setTranslationStatus(
  slug: string,
  locale: string,
  status: "draft" | "in_review" | "published",
): Promise<TranslationSaveResult> {
  const actor = await requirePermission(
    status === "in_review" ? "translation:write" : "translation:review",
  );

  const target = targetLocale(locale);
  if (!target)
    return { ok: false, problem: "That is not a locale to translate into." };

  const view = await getLessonTranslation(slug, target);
  if (!view) return { ok: false, problem: "That lesson does not exist." };
  if (!view.translation) {
    // Not a silent no-op: a button that appears to work and changes nothing is
    // worse than one that says why it cannot.
    return { ok: false, problem: "There is nothing written to publish yet." };
  }

  await setLessonTranslationStatus(
    view.lessonId,
    target,
    status,
    status === "published" ? actor.userId : null,
  );

  await getDb()
    .insert(auditLog)
    .values({
      actorId: actor.userId,
      action: `translation.${status === "published" ? "publish" : status === "in_review" ? "submit" : "unpublish"}`,
      targetType: "lesson",
      targetId: view.lessonId,
      before: { locale: target, status: view.translation.status },
      after: { locale: target, status },
    });

  await recordActivity({
    verb: status === "published" ? "admin.published" : "admin.updated",
    objectType: "lesson",
    objectId: view.lessonId,
    metadata: { translation: target, status },
  });

  revalidatePath(`/admin/lessons/${slug}/translate`);
  revalidatePath(`/admin/lessons`);
  for (const path of localizedPaths(`/lessons/${slug}`)) {
    revalidatePath(path);
  }

  return { ok: true };
}
