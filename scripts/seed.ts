/**
 * Seeds the database from the JSON in `data/`.
 *
 *   pnpm db:seed
 *
 * Idempotent: every insert upserts on a natural key, so running it twice
 * changes no row count and mutates nothing but `updated_at`. Wrapped in one
 * transaction — a partial seed is worse than none.
 *
 * Connects via DATABASE_URL_UNPOOLED (the direct endpoint), because the work
 * is transactional and PgBouncer in transaction mode cannot hold what it needs.
 */
import "@/lib/load-env";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { neonConfig, Pool as NeonPool } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-serverless";
import { drizzle as drizzleNode } from "drizzle-orm/node-postgres";
import { Pool as NodePool } from "pg";
import ws from "ws";
import { driverFor } from "@/db/driver";
import { eq, sql } from "drizzle-orm";
import * as schema from "@/db/schema";
import {
  toElementRow,
  toLessonRow,
  toLessonSectionRows,
  toQuestionRows,
  toQuizRow,
  type ElementJson,
  type LessonJson,
  type QuizJson,
} from "@/db/seed/transform";

neonConfig.webSocketConstructor = ws;

const DATA = path.join(process.cwd(), "data");

async function readJson<T>(...segments: string[]): Promise<T> {
  return JSON.parse(await readFile(path.join(DATA, ...segments), "utf8")) as T;
}

async function main() {
  const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
  if (!url) {
    console.error(
      "Set DATABASE_URL_UNPOOLED (preferred) or DATABASE_URL before seeding.",
    );
    process.exit(1);
  }

  // The seed is transactional, so it needs a real connection either way:
  // Neon's WebSocket pool, or plain node-postgres for everything else.
  const isNeon = driverFor(url) === "neon";
  const pool = isNeon
    ? new NeonPool({ connectionString: url })
    : new NodePool({ connectionString: url });
  const db = isNeon
    ? drizzleNeon(pool as NeonPool, { schema, casing: "snake_case" })
    : drizzleNode(pool as NodePool, { schema, casing: "snake_case" });

  const elementsJson = await readJson<ElementJson[]>(
    "periodic-table-detailed.json",
  );
  const lessonsJson = await readJson<LessonJson[]>("lessons.json");
  const quizzesJson = await readJson<QuizJson[]>("quiz.json");
  const introduction = await readJson<{
    slug: string;
    sections: { heading: string; body: string }[];
  }>("lessons", "introduction-basics.json");

  try {
    await db.transaction(async (tx) => {
      // ── Elements ───────────────────────────────────────────────────────
      for (const json of elementsJson) {
        const row = toElementRow(json);
        await tx
          .insert(schema.elements)
          .values(row)
          .onConflictDoUpdate({ target: schema.elements.number, set: row });
      }

      // ── Lessons ────────────────────────────────────────────────────────
      for (const json of lessonsJson) {
        const row = toLessonRow(json);
        const [lesson] = await tx
          .insert(schema.lessons)
          .values(row)
          .onConflictDoUpdate({ target: schema.lessons.slug, set: row })
          .returning({ id: schema.lessons.id });

        // Default-locale translation row, so reads can always join on locale.
        await tx
          .insert(schema.lessonTranslations)
          .values({
            lessonId: lesson.id,
            locale: "en",
            title: row.title,
            description: row.description,
          })
          .onConflictDoUpdate({
            target: [
              schema.lessonTranslations.lessonId,
              schema.lessonTranslations.locale,
            ],
            set: { title: row.title, description: row.description },
          });

        if (json.slug === introduction.slug) {
          for (const section of toLessonSectionRows(introduction.sections)) {
            await tx
              .insert(schema.lessonSections)
              .values({ lessonId: lesson.id, ...section })
              .onConflictDoUpdate({
                target: [
                  schema.lessonSections.lessonId,
                  schema.lessonSections.position,
                ],
                set: { heading: section.heading, body: section.body },
              });
          }
        }
      }

      // ── Quizzes ────────────────────────────────────────────────────────
      for (const json of quizzesJson) {
        const row = toQuizRow(json);
        const [quiz] = await tx
          .insert(schema.quizzes)
          .values(row)
          .onConflictDoUpdate({ target: schema.quizzes.slug, set: row })
          .returning({ id: schema.quizzes.id });

        await tx
          .insert(schema.quizTranslations)
          .values({
            quizId: quiz.id,
            locale: "en",
            title: row.title,
            description: row.description,
          })
          .onConflictDoUpdate({
            target: [
              schema.quizTranslations.quizId,
              schema.quizTranslations.locale,
            ],
            set: { title: row.title, description: row.description },
          });

        for (const question of toQuestionRows(json)) {
          const [saved] = await tx
            .insert(schema.quizQuestions)
            .values({
              quizId: quiz.id,
              position: question.position,
              prompt: question.prompt,
              explanation: question.explanation,
            })
            .onConflictDoUpdate({
              target: [
                schema.quizQuestions.quizId,
                schema.quizQuestions.position,
              ],
              set: {
                prompt: question.prompt,
                explanation: question.explanation,
              },
            })
            .returning({ id: schema.quizQuestions.id });

          // Options first, then point the question at the correct one: the
          // reference is circular (question -> option -> question), so it can
          // only be satisfied in two steps inside the transaction.
          const savedOptions = [];
          for (const option of question.options) {
            const [savedOption] = await tx
              .insert(schema.quizOptions)
              .values({ questionId: saved.id, ...option })
              .onConflictDoUpdate({
                target: [
                  schema.quizOptions.questionId,
                  schema.quizOptions.position,
                ],
                set: { label: option.label },
              })
              .returning({ id: schema.quizOptions.id });
            savedOptions.push(savedOption);
          }

          const correct = savedOptions[question.correctOptionPosition];
          if (!correct) {
            throw new Error(
              `quiz "${json.slug}" question ${question.position + 1}: correct option did not save`,
            );
          }

          await tx
            .update(schema.quizQuestions)
            .set({ correctOptionId: correct.id })
            .where(eq(schema.quizQuestions.id, saved.id));
        }
      }
    });

    // ── Verification ─────────────────────────────────────────────────────
    // Counts are the floor, not the ceiling: an unresolved answer is the
    // failure this migration exists to make impossible.
    const [{ count: elementCount }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.elements);
    const [{ count: lessonCount }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.lessons);
    const [{ count: quizCount }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.quizzes);
    const [{ count: questionCount }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.quizQuestions);
    const [{ count: unresolved }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.quizQuestions)
      .where(sql`${schema.quizQuestions.correctOptionId} is null`);

    console.log(`elements   ${elementCount}`);
    console.log(`lessons    ${lessonCount}`);
    console.log(`quizzes    ${quizCount}`);
    console.log(`questions  ${questionCount}`);

    const expected = {
      elements: elementsJson.length,
      lessons: lessonsJson.length,
      quizzes: quizzesJson.length,
      questions: quizzesJson.reduce((n, q) => n + q.questions.length, 0),
    };

    const problems: string[] = [];
    if (elementCount !== expected.elements)
      problems.push(
        `elements: expected ${expected.elements}, found ${elementCount}`,
      );
    if (lessonCount !== expected.lessons)
      problems.push(
        `lessons: expected ${expected.lessons}, found ${lessonCount}`,
      );
    if (quizCount !== expected.quizzes)
      problems.push(
        `quizzes: expected ${expected.quizzes}, found ${quizCount}`,
      );
    if (questionCount !== expected.questions)
      problems.push(
        `questions: expected ${expected.questions}, found ${questionCount}`,
      );
    if (unresolved > 0)
      problems.push(`${unresolved} question(s) have no correct option`);

    if (problems.length > 0) {
      console.error("\nVerification failed:");
      for (const problem of problems) console.error(`  ${problem}`);
      process.exit(1);
    }

    console.log("\nverified");
  } catch (error) {
    console.error("Seed failed; the transaction was rolled back.");
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  } finally {
    await pool.end();
  }
}

void main();
