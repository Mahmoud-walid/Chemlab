import type { LessonBlock } from "@/lib/lessons/blocks";
import * as schema from "@/db/schema";
import type { SeedDatabase } from "@/db/seed/connect";
import { testSlug } from "./ids";

/**
 * Rows that are valid because the factory knows the schema, not because the
 * test remembered it.
 *
 * The point is not brevity. Every suite that hand-rolls a fixture has to know
 * things about the schema that have nothing to do with what it is testing —
 * that a section body is an array of blocks with ids and rich-text runs, that
 * a comment needs its threading columns, that a translation's `source_hash`
 * must be read back from a generated column rather than computed. Each of
 * those has already cost a test failure that looked like a bug in the code
 * under test.
 *
 * Every factory takes overrides, so a test still says the one thing it cares
 * about — `status: "published"` — and says nothing about the rest.
 */

/** A body with one readable paragraph. Valid against `blocksSchema`. */
export function paragraphBody(text = "Words."): LessonBlock[] {
  return [{ id: "p1", type: "paragraph", text: [{ text }] }];
}

export interface LessonOverrides {
  slug?: string;
  title?: string;
  description?: string;
  difficulty?: "easy" | "medium" | "hard";
  category?: string;
  status?: "draft" | "published" | "archived";
  publishedAt?: Date | null;
  /** How many sections to create. A lesson with none cannot be published. */
  sections?: number;
}

export interface CreatedLesson {
  id: string;
  slug: string;
  title: string;
  /** Read back from the generated column — never recomputed. */
  sourceHash: string;
  sectionIds: string[];
}

/**
 * A lesson, and optionally its sections.
 *
 * `sourceHash` is returned because a translation must be written against the
 * value the database generated. Recomputing it in a test is the same mistake
 * `db/queries/translations.ts` exists to prevent, one layer down.
 */
export async function createLesson(
  db: SeedDatabase,
  overrides: LessonOverrides = {},
): Promise<CreatedLesson> {
  const slug = overrides.slug ?? testSlug("factory-lesson");

  const [lesson] = await db
    .insert(schema.lessons)
    .values({
      slug,
      title: overrides.title ?? "A lesson",
      description: overrides.description ?? "Made by a test factory.",
      difficulty: overrides.difficulty ?? "easy",
      category: overrides.category ?? "Testing",
      status: overrides.status ?? "draft",
      ...(overrides.publishedAt !== undefined
        ? { publishedAt: overrides.publishedAt }
        : {}),
    })
    .returning({
      id: schema.lessons.id,
      title: schema.lessons.title,
      sourceHash: schema.lessons.sourceHash,
    });

  const sectionIds: string[] = [];
  for (let index = 0; index < (overrides.sections ?? 0); index++) {
    const [section] = await db
      .insert(schema.lessonSections)
      .values({
        lessonId: lesson!.id,
        position: index + 1,
        heading: `Heading ${index + 1}`,
        body: paragraphBody(),
      })
      .returning({ id: schema.lessonSections.id });
    sectionIds.push(section!.id);
  }

  return {
    id: lesson!.id,
    slug,
    title: lesson!.title,
    sourceHash: lesson!.sourceHash,
    sectionIds,
  };
}

export interface CreatedSection {
  id: string;
  heading: string;
  sourceHash: string;
}

export async function createSection(
  db: SeedDatabase,
  lessonId: string,
  overrides: { position?: number; heading?: string; body?: LessonBlock[] } = {},
): Promise<CreatedSection> {
  const [section] = await db
    .insert(schema.lessonSections)
    .values({
      lessonId,
      position: overrides.position ?? 1,
      heading: overrides.heading ?? "A heading",
      body: overrides.body ?? paragraphBody(),
    })
    .returning({
      id: schema.lessonSections.id,
      heading: schema.lessonSections.heading,
      sourceHash: schema.lessonSections.sourceHash,
    });

  return section!;
}

export interface QuizOverrides {
  slug?: string;
  title?: string;
  description?: string;
  difficulty?: "easy" | "medium" | "hard";
  category?: string;
  status?: "draft" | "published" | "archived";
  /** How many questions to create. A quiz with none cannot be published. */
  questions?: number;
}

export interface CreatedQuiz {
  id: string;
  slug: string;
  title: string;
  sourceHash: string;
  questionIds: string[];
}

export async function createQuiz(
  db: SeedDatabase,
  overrides: QuizOverrides = {},
): Promise<CreatedQuiz> {
  const slug = overrides.slug ?? testSlug("factory-quiz");

  const [quiz] = await db
    .insert(schema.quizzes)
    .values({
      slug,
      title: overrides.title ?? "A quiz",
      description: overrides.description ?? "Made by a test factory.",
      difficulty: overrides.difficulty ?? "easy",
      category: overrides.category ?? "Testing",
      status: overrides.status ?? "draft",
    })
    .returning({
      id: schema.quizzes.id,
      title: schema.quizzes.title,
      sourceHash: schema.quizzes.sourceHash,
    });

  const questionIds: string[] = [];
  for (let index = 0; index < (overrides.questions ?? 0); index++) {
    questionIds.push(
      (await createQuestion(db, quiz!.id, { position: index + 1 })).id,
    );
  }

  return {
    id: quiz!.id,
    slug,
    title: quiz!.title,
    sourceHash: quiz!.sourceHash,
    questionIds,
  };
}

export interface CreatedQuestion {
  id: string;
  prompt: string;
  sourceHash: string;
}

export async function createQuestion(
  db: SeedDatabase,
  quizId: string,
  overrides: { position?: number; prompt?: string; explanation?: string } = {},
): Promise<CreatedQuestion> {
  const [question] = await db
    .insert(schema.quizQuestions)
    .values({
      quizId,
      position: overrides.position ?? 1,
      prompt: overrides.prompt ?? `Question ${overrides.position ?? 1}?`,
      explanation: overrides.explanation ?? "Because.",
    })
    .returning({
      id: schema.quizQuestions.id,
      prompt: schema.quizQuestions.prompt,
      sourceHash: schema.quizQuestions.sourceHash,
    });

  return question!;
}
