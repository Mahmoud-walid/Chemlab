import { sql } from "drizzle-orm";

import * as schema from "@/db/schema";
import type { SeedDatabase } from "@/db/seed/connect";
import { paragraphBody } from "./content";
import type { LessonBlock } from "@/lib/lessons/blocks";

/**
 * Translations, with the source fingerprint read back rather than computed.
 *
 * `source_hash` is a generated column on the source table. Every writer in the
 * application copies it in the same statement precisely so a second
 * implementation of the hash cannot appear and drift; a test factory that
 * computed it would be that second implementation, and every suite using it
 * would agree with itself and disagree with the product.
 *
 * The subquery is the same one `db/queries/translations.ts` uses.
 */

type Status = "draft" | "in_review" | "published";

const hashOf = (
  table: "lessons" | "lesson_sections" | "quizzes" | "quiz_questions",
  id: string,
) => sql`(select source_hash from ${sql.raw(table)} where id = ${id})`;

export async function translateLesson(
  db: SeedDatabase,
  lessonId: string,
  overrides: {
    locale?: string;
    title?: string;
    description?: string;
    status?: Status;
    translatedBy?: string;
  } = {},
): Promise<void> {
  await db
    .insert(schema.lessonTranslations)
    .values({
      lessonId,
      locale: overrides.locale ?? "ar",
      title: overrides.title ?? "عنوان",
      description: overrides.description ?? "وصف",
      status: overrides.status ?? "draft",
      ...(overrides.translatedBy
        ? { translatedBy: overrides.translatedBy }
        : {}),
      sourceHash: hashOf("lessons", lessonId),
    })
    .onConflictDoUpdate({
      target: [
        schema.lessonTranslations.lessonId,
        schema.lessonTranslations.locale,
      ],
      set: {
        status: overrides.status ?? "draft",
        sourceHash: hashOf("lessons", lessonId),
      },
    });
}

export async function translateSection(
  db: SeedDatabase,
  sectionId: string,
  overrides: {
    locale?: string;
    heading?: string;
    body?: LessonBlock[];
    status?: Status;
  } = {},
): Promise<void> {
  await db
    .insert(schema.lessonSectionTranslations)
    .values({
      sectionId,
      locale: overrides.locale ?? "ar",
      heading: overrides.heading ?? "عنوان فرعي",
      body: overrides.body ?? paragraphBody("كلمات."),
      status: overrides.status ?? "draft",
      sourceHash: hashOf("lesson_sections", sectionId),
    })
    .onConflictDoUpdate({
      target: [
        schema.lessonSectionTranslations.sectionId,
        schema.lessonSectionTranslations.locale,
      ],
      set: {
        status: overrides.status ?? "draft",
        sourceHash: hashOf("lesson_sections", sectionId),
      },
    });
}

export async function translateQuiz(
  db: SeedDatabase,
  quizId: string,
  overrides: { locale?: string; status?: Status; title?: string } = {},
): Promise<void> {
  await db.insert(schema.quizTranslations).values({
    quizId,
    locale: overrides.locale ?? "ar",
    title: overrides.title ?? "اختبار",
    description: "وصف",
    status: overrides.status ?? "draft",
    sourceHash: hashOf("quizzes", quizId),
  });
}

export async function translateQuestion(
  db: SeedDatabase,
  questionId: string,
  overrides: { locale?: string; status?: Status } = {},
): Promise<void> {
  await db.insert(schema.quizQuestionTranslations).values({
    questionId,
    locale: overrides.locale ?? "ar",
    prompt: "سؤال",
    explanation: "لأن.",
    status: overrides.status ?? "draft",
    sourceHash: hashOf("quiz_questions", questionId),
  });
}
