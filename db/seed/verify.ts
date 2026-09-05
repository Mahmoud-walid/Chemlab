/**
 * Field-level verification that the database matches the JSON in `data/`.
 *
 * Row counts are the floor, not the ceiling: a seed that silently dropped
 * `ionization_energies` or mapped `melt` onto `boil` produces exactly the
 * right counts. This compares every scalar and both array columns, element by
 * element, and resolves each question's `correct_option_id` back to a label.
 *
 * Returns the problems it found rather than throwing, so one run reports
 * everything wrong instead of only the first thing.
 */
import { asc, eq } from "drizzle-orm";

import * as schema from "@/db/schema";
import type { SeedDatabase } from "./connect";
import { loadSeedSource } from "./source";
import { richTextToText, toElementRow } from "./transform";

/** Floats survive the JSON -> double precision round trip exactly, but only
 * within the precision Postgres stores. Compared with a relative epsilon so a
 * real mismatch is caught and a last-bit difference is not reported as one. */
function numbersDiffer(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return a !== b;
  if (a === b) return false;
  return Math.abs(a - b) > Math.max(Math.abs(a), Math.abs(b)) * 1e-12;
}

function arraysDiffer(a: readonly number[], b: readonly number[]): boolean {
  return (
    a.length !== b.length || a.some((value, i) => numbersDiffer(value, b[i]!))
  );
}

export async function verifyContent(db: SeedDatabase): Promise<string[]> {
  const source = await loadSeedSource();
  const problems: string[] = [];

  // ── Elements: every field, not just the count ─────────────────────────────
  const elementRows = await db
    .select()
    .from(schema.elements)
    .orderBy(asc(schema.elements.number));
  const byNumber = new Map(elementRows.map((row) => [row.number, row]));

  if (elementRows.length !== source.elements.length) {
    problems.push(
      `elements: expected ${source.elements.length}, found ${elementRows.length}`,
    );
  }

  for (const json of source.elements) {
    const expected = toElementRow(json);
    const row = byNumber.get(expected.number);
    if (!row) {
      problems.push(
        `elements: ${expected.symbol} (${expected.number}) missing`,
      );
      continue;
    }

    for (const [key, want] of Object.entries(expected)) {
      const got = row[key as keyof typeof row];
      const differs = Array.isArray(want)
        ? arraysDiffer(want as number[], got as number[])
        : typeof want === "number" || typeof got === "number"
          ? numbersDiffer(want as number | null, got as number | null)
          : want !== got;
      if (differs) {
        problems.push(
          `elements: ${expected.symbol}.${key} is ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`,
        );
      }
    }
  }

  // ── Lessons and their sections ────────────────────────────────────────────
  const lessonRows = await db
    .select()
    .from(schema.lessons)
    .orderBy(asc(schema.lessons.slug));
  const bySlug = new Map(lessonRows.map((row) => [row.slug, row]));

  if (lessonRows.length !== source.lessons.length) {
    problems.push(
      `lessons: expected ${source.lessons.length}, found ${lessonRows.length}`,
    );
  }

  for (const json of source.lessons) {
    const row = bySlug.get(json.slug);
    if (!row) {
      problems.push(`lessons: "${json.slug}" missing`);
      continue;
    }
    if (row.title !== json.title)
      problems.push(`lessons: ${json.slug}.title differs`);
    if (row.description !== json.description)
      problems.push(`lessons: ${json.slug}.description differs`);
    if (row.difficulty !== json.difficulty)
      problems.push(`lessons: ${json.slug}.difficulty differs`);
    if (row.category !== json.category)
      problems.push(`lessons: ${json.slug}.category differs`);
    if (
      JSON.stringify(row.references) !== JSON.stringify(json.references ?? [])
    ) {
      problems.push(`lessons: ${json.slug}.references differ`);
    }
    // A lesson nobody can see is indistinguishable from one that failed to
    // seed, so publication is verified rather than assumed. Both halves are
    // checked: `status` is what the public queries filter on, `published_at`
    // is the record of when it went live, and one without the other is a row
    // whose two answers to "is this live" disagree.
    if (row.status !== "published")
      problems.push(`lessons: ${json.slug} is ${row.status}, not published`);
    if (row.publishedAt === null)
      problems.push(`lessons: ${json.slug} has no publication date`);

    const body = source.bodies.get(json.slug);
    const sections = await db
      .select()
      .from(schema.lessonSections)
      .where(eq(schema.lessonSections.lessonId, row.id))
      .orderBy(asc(schema.lessonSections.position));

    if (sections.length !== (body?.sections.length ?? 0)) {
      problems.push(
        `lesson_sections: ${json.slug} has ${sections.length}, expected ${body?.sections.length ?? 0}`,
      );
      continue;
    }
    body?.sections.forEach((want, index) => {
      const got = sections[index]!;
      if (got.heading !== want.heading)
        problems.push(
          `lesson_sections: ${json.slug}[${index}].heading differs`,
        );
      // The rich-text wrapping must be lossless: unwrapping it has to give the
      // original prose back, or the migration quietly rewrote the lesson.
      if (richTextToText(got.body) !== want.body.trim())
        problems.push(`lesson_sections: ${json.slug}[${index}].body differs`);
    });
  }

  // ── Quizzes: the answer must resolve through the foreign key ──────────────
  const quizRows = await db
    .select()
    .from(schema.quizzes)
    .orderBy(asc(schema.quizzes.slug));
  const quizBySlug = new Map(quizRows.map((row) => [row.slug, row]));

  if (quizRows.length !== source.quizzes.length) {
    problems.push(
      `quizzes: expected ${source.quizzes.length}, found ${quizRows.length}`,
    );
  }

  for (const json of source.quizzes) {
    const quiz = quizBySlug.get(json.slug);
    if (!quiz) {
      problems.push(`quizzes: "${json.slug}" missing`);
      continue;
    }

    const rows = await db
      .select({
        position: schema.quizQuestions.position,
        prompt: schema.quizQuestions.prompt,
        explanation: schema.quizQuestions.explanation,
        correctOptionId: schema.quizQuestions.correctOptionId,
        optionId: schema.quizOptions.id,
        optionPosition: schema.quizOptions.position,
        label: schema.quizOptions.label,
      })
      .from(schema.quizQuestions)
      .innerJoin(
        schema.quizOptions,
        eq(schema.quizOptions.questionId, schema.quizQuestions.id),
      )
      .where(eq(schema.quizQuestions.quizId, quiz.id))
      .orderBy(
        asc(schema.quizQuestions.position),
        asc(schema.quizOptions.position),
      );

    json.questions.forEach((want, index) => {
      const forQuestion = rows.filter((row) => row.position === index);
      if (forQuestion.length === 0) {
        problems.push(`quiz_questions: ${json.slug}[${index}] missing`);
        return;
      }
      const [first] = forQuestion;
      if (first!.prompt !== want.question)
        problems.push(`quiz_questions: ${json.slug}[${index}].prompt differs`);
      if (first!.explanation !== want.explanation)
        problems.push(
          `quiz_questions: ${json.slug}[${index}].explanation differs`,
        );

      const labels = forQuestion.map((row) => row.label);
      if (JSON.stringify(labels) !== JSON.stringify(want.options)) {
        problems.push(
          `quiz_options: ${json.slug}[${index}] are ${JSON.stringify(labels)}, expected ${JSON.stringify(want.options)}`,
        );
      }

      if (first!.correctOptionId === null) {
        problems.push(
          `quiz_questions: ${json.slug}[${index}].correct_option_id is null`,
        );
        return;
      }
      const correct = forQuestion.find(
        (row) => row.optionId === first!.correctOptionId,
      );
      if (!correct) {
        problems.push(
          `quiz_questions: ${json.slug}[${index}].correct_option_id points outside its own options`,
        );
      } else if (correct.label !== want.answer) {
        problems.push(
          `quiz_questions: ${json.slug}[${index}] answer is "${correct.label}", expected "${want.answer}"`,
        );
      }
    });
  }

  return problems;
}
