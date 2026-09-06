"use server";

import { revalidatePath } from "next/cache";

import { getDb } from "@/db/client";
import { auditLog } from "@/db/schema/rbac";
import {
  claimQuizTranslator,
  getQuizTranslation,
  saveQuizTranslation,
  setQuizTranslationStatus,
} from "@/db/queries/admin/quiz-translations";
import { recordActivity } from "@/lib/activity/record";
import { requirePermission } from "@/lib/authz";
import { isSubmittable } from "@/lib/translations/quiz-completeness";
import { isSupportedLocale, defaultLocale } from "@/i18n/routing";
import { localizedPaths } from "@/i18n/paths";

/**
 * Writing and signing off a quiz translation.
 *
 * The same two permissions as the lesson editor, for the same reason:
 * `translation:write` writes words, `translation:review` decides they are good
 * enough for a reader, and the `editor` role holds the first and not the
 * second — so nobody publishes their own chemistry translation unchecked.
 *
 * Neither action trusts the browser for STRUCTURE. The questions and options
 * written are the ones the database says this quiz has; the form's ids are
 * used only to look up which text belongs where, and an id the quiz does not
 * own is ignored rather than inserted. There is therefore no path by which a
 * translation can gain, lose or reorder a question or an option relative to
 * its source — which for a quiz would not merely look wrong, it would change
 * which answer is which.
 */

export interface QuizTranslationSaveResult {
  ok: boolean;
  problem?: string;
}

/** Neither the default locale nor anything the router does not know. */
function targetLocale(locale: string): string | null {
  if (!isSupportedLocale(locale)) return null;
  // Translating the default locale into itself is not a thing to allow: the
  // `en` row mirrors the source and is maintained by the quiz's own save.
  return locale === defaultLocale ? null : locale;
}

export interface QuizTranslationFields {
  title: string;
  description: string;
  /** Keyed by question id. */
  prompts: Record<string, string>;
  explanations: Record<string, string>;
  /** Keyed by OPTION id, flat: option ids are unique across the quiz. */
  optionLabels: Record<string, string>;
}

export async function saveQuizTranslationAction(
  slug: string,
  locale: string,
  fields: QuizTranslationFields,
): Promise<QuizTranslationSaveResult> {
  const actor = await requirePermission("translation:write");

  const target = targetLocale(locale);
  if (!target)
    return { ok: false, problem: "That is not a locale to translate into." };

  // Re-read the source rather than trusting what the form was rendered from.
  // A quiz that gained a question while somebody had the form open must not be
  // overwritten by a translation built against the older structure.
  const view = await getQuizTranslation(slug, target);
  if (!view) return { ok: false, problem: "That quiz does not exist." };

  if (fields.title.trim() === "") {
    return { ok: false, problem: "A translation needs a title." };
  }

  // Built from the SOURCE rows, not from the posted keys. A blank box keeps
  // the English rather than storing an empty string: an empty translation row
  // is worse than an absent one, because `chooseForGroup` reads it as present
  // and would serve a blank answer option to a candidate.
  const questions = view.questions.map((question) => ({
    id: question.id,
    prompt: fields.prompts[question.id]?.trim()
      ? fields.prompts[question.id]!
      : question.prompt,
    explanation: fields.explanations[question.id]?.trim()
      ? fields.explanations[question.id]!
      : question.explanation,
    options: question.options.map((option) => ({
      id: option.id,
      label: fields.optionLabels[option.id]?.trim()
        ? fields.optionLabels[option.id]!
        : option.label,
    })),
  }));

  await saveQuizTranslation(view.quizId, target, {
    title: fields.title,
    description: fields.description,
    questions,
  });
  await claimQuizTranslator(view.quizId, target, actor.userId);

  await getDb()
    .insert(auditLog)
    .values({
      actorId: actor.userId,
      action: "translation.update",
      targetType: "quiz",
      targetId: view.quizId,
      // The text itself is not recorded. It is the largest thing in the
      // database and the audit log is never pruned; what matters later is
      // that the translation changed, into what language, and by whom.
      before: { locale: target, status: view.translation?.status ?? null },
      after: {
        locale: target,
        questions: questions.length,
        options: questions.reduce((n, q) => n + q.options.length, 0),
      },
    });

  await recordActivity({
    verb: "admin.updated",
    objectType: "quiz",
    objectId: view.quizId,
    metadata: { translation: target },
  });

  revalidateQuizTranslation(slug);
  return { ok: true };
}

/**
 * Submitting for review needs only `translation:write` — asking somebody to
 * check your work is part of doing it. Publishing and sending back both need
 * `translation:review`.
 */
export async function setQuizTranslationStatusAction(
  slug: string,
  locale: string,
  status: "draft" | "in_review" | "published",
): Promise<QuizTranslationSaveResult> {
  const actor = await requirePermission(
    status === "in_review" ? "translation:write" : "translation:review",
  );

  const target = targetLocale(locale);
  if (!target)
    return { ok: false, problem: "That is not a locale to translate into." };

  const view = await getQuizTranslation(slug, target);
  if (!view) return { ok: false, problem: "That quiz does not exist." };
  if (!view.translation) {
    // Not a silent no-op: a button that appears to work and changes nothing is
    // worse than one that says why it cannot.
    return { ok: false, problem: "There is nothing written to publish yet." };
  }

  // The rule with no lesson equivalent, and it is checked on the SERVER
  // because the browser's copy of it only decides whether a button looks
  // enabled. A question whose options are partly translated is served to
  // readers entirely in English by `chooseForGroup` — so submitting one would
  // move it along the workflow while changing nothing anybody can see.
  if (status !== "draft") {
    const submittable = isSubmittable(
      {
        title: view.translation.title,
        description: view.translation.description,
      },
      view.questions.map((question) => ({
        id: question.id,
        prompt: question.translatedPrompt ?? "",
        explanation: question.translatedExplanation ?? "",
        options: question.options.map((option) => ({
          id: option.id,
          label: option.translatedLabel ?? "",
        })),
      })),
    );

    if (!submittable) {
      return {
        ok: false,
        problem:
          "Every question needs its prompt, its explanation and all of its " +
          "options translated. A question translated in part is served to " +
          "readers in English.",
      };
    }
  }

  await setQuizTranslationStatus(
    view.quizId,
    target,
    status,
    status === "published" ? actor.userId : null,
  );

  await getDb()
    .insert(auditLog)
    .values({
      actorId: actor.userId,
      action: `translation.${status === "published" ? "publish" : status === "in_review" ? "submit" : "unpublish"}`,
      targetType: "quiz",
      targetId: view.quizId,
      before: { locale: target, status: view.translation.status },
      after: { locale: target, status },
    });

  await recordActivity({
    verb: status === "published" ? "admin.published" : "admin.updated",
    objectType: "quiz",
    objectId: view.quizId,
    metadata: { translation: target, status },
  });

  revalidateQuizTranslation(slug);
  return { ok: true };
}

function revalidateQuizTranslation(slug: string) {
  revalidatePath(`/admin/quizzes/${slug}/translate`);
  revalidatePath(`/admin/quizzes`);
  // Every locale's copy of the reader page, not just the default one. Under
  // `localePrefix: "as-needed"` the Arabic page is a different cache entry at
  // a different URL — see i18n/paths.ts — and it is the one this change is
  // actually about.
  for (const path of localizedPaths(`/quiz/${slug}`)) {
    revalidatePath(path);
  }
}
