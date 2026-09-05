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
import { eq, sql } from "drizzle-orm";
import * as schema from "@/db/schema";
import { connect, seedUrl } from "@/db/seed/connect";
import { loadSeedSource } from "@/db/seed/source";
import { seedAuthorization } from "@/db/seed/authorization";
import { verifyContent } from "@/db/seed/verify";
import {
  toElementRow,
  toLessonRow,
  toLessonSectionRows,
  toQuestionRows,
  toQuizRow,
} from "@/db/seed/transform";
import { readingTimeSeconds } from "@/lib/lessons/reading-time";

async function main() {
  const url = seedUrl();
  if (!url) {
    console.error(
      "Set DATABASE_URL_UNPOOLED (preferred) or DATABASE_URL before seeding.",
    );
    process.exit(1);
  }

  const { db, close } = connect(url);
  const source = await loadSeedSource();
  const {
    elements: elementsJson,
    lessons: lessonsJson,
    quizzes: quizzesJson,
  } = source;

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
      for (const [index, json] of lessonsJson.entries()) {
        const row = toLessonRow(json);
        const [lesson] = await tx
          .insert(schema.lessons)
          // Everything in the JSON is live content, so it is published on
          // first insert. On conflict the date is COALESCEd rather than
          // overwritten: re-seeding backfills a lesson that has none but must
          // never reset the publication date of one already live.
          //
          // `status` and `position` are set on insert but deliberately absent
          // from the conflict branch: they are the editor's to change, and a
          // re-seed that republished a lesson someone had taken back to draft
          // would undo an editorial decision without saying so.
          .values({
            ...row,
            status: "published",
            // Gaps of ten, so a lesson can be moved between two others without
            // renumbering the rest.
            position: (index + 1) * 10,
            publishedAt: sql`now()`,
          })
          .onConflictDoUpdate({
            target: schema.lessons.slug,
            set: {
              ...row,
              publishedAt: sql`coalesce(${schema.lessons.publishedAt}, now())`,
            },
          })
          .returning({
            id: schema.lessons.id,
            sourceHash: schema.lessons.sourceHash,
          });

        // Default-locale translation row, so reads can always join on locale.
        await tx
          .insert(schema.lessonTranslations)
          .values({
            lessonId: lesson.id,
            locale: "en",
            title: row.title,
            description: row.description,
            // This row IS the English copy, not a translation of it: live,
            // and by definition never stale against its own source. The hash
            // is read back from the generated column rather than recomputed
            // here — see db/queries/translations.ts.
            status: "published",
            sourceHash: lesson.sourceHash,
          })
          .onConflictDoUpdate({
            target: [
              schema.lessonTranslations.lessonId,
              schema.lessonTranslations.locale,
            ],
            set: {
              title: row.title,
              description: row.description,
              status: "published",
              sourceHash: lesson.sourceHash,
            },
          });

        // Not every lesson has a body written yet; the rest seed as
        // summary-only rows until their content exists.
        const body = source.bodies.get(json.slug);
        if (body) {
          const rows = toLessonSectionRows(json.slug, body.sections);
          for (const section of rows) {
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

          // Computed here, at write time, for the same reason the editor will
          // compute it at save time: it is the same number for every reader,
          // and a page that recomputes it per request charges the reader for
          // work whose answer never changes.
          await tx
            .update(schema.lessons)
            .set({
              readingTimeSeconds: readingTimeSeconds(
                rows.flatMap((section) => section.body),
              ),
            })
            .where(eq(schema.lessons.id, lesson.id));
        }
      }

      // ── Quizzes ────────────────────────────────────────────────────────
      for (const [index, json] of quizzesJson.entries()) {
        const row = toQuizRow(json);
        const [quiz] = await tx
          .insert(schema.quizzes)
          // Live content, so it is published on first insert; on conflict the
          // date is COALESCEd rather than overwritten. `status` and `position`
          // are absent from the conflict branch for the same reason they are
          // for lessons: they are the editor's to change, and a re-seed that
          // republished a withdrawn quiz would undo an editorial decision
          // without saying so.
          .values({
            ...row,
            status: "published",
            // Gaps of ten, so a quiz can be moved between two others without
            // renumbering the rest.
            position: (index + 1) * 10,
            publishedAt: sql`now()`,
          })
          .onConflictDoUpdate({
            target: schema.quizzes.slug,
            set: {
              ...row,
              publishedAt: sql`coalesce(${schema.quizzes.publishedAt}, now())`,
            },
          })
          .returning({
            id: schema.quizzes.id,
            sourceHash: schema.quizzes.sourceHash,
          });

        await tx
          .insert(schema.quizTranslations)
          .values({
            quizId: quiz.id,
            locale: "en",
            title: row.title,
            description: row.description,
            status: "published",
            sourceHash: quiz.sourceHash,
          })
          .onConflictDoUpdate({
            target: [
              schema.quizTranslations.quizId,
              schema.quizTranslations.locale,
            ],
            set: {
              title: row.title,
              description: row.description,
              status: "published",
              sourceHash: quiz.sourceHash,
            },
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

      // ── Authorization ──────────────────────────────────────────────────
      // Roles and permissions are deployment-time data, not runtime data, so
      // they are seeded rather than created through an authorized API — there
      // is nobody to authorize the very first grant.
      await seedAuthorization(tx);
    });

    // ── Verification ─────────────────────────────────────────────────────
    // Counts first because a wrong count localises the problem instantly,
    // then verifyContent compares every field against the JSON.
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

    /**
     * Scoring reads `quiz_options.is_correct`, not `correct_option_id`. The
     * trigger added in 0010 keeps the two in step for single-choice
     * questions, and this is the assertion that the trigger actually ran —
     * without it a broken sync ships as "every candidate scored zero", which
     * looks like a scoring bug and is not one.
     */
    const [{ count: unmarked }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.quizQuestions)
      .where(
        sql`not exists (
          select 1 from ${schema.quizOptions} o
          where o.question_id = ${schema.quizQuestions.id} and o.is_correct
        )`,
      );

    console.log(`elements   ${elementCount}`);
    console.log(`lessons    ${lessonCount}`);
    console.log(`quizzes    ${quizCount}`);
    console.log(`questions  ${questionCount}`);
    console.log(`roles      ${await db.$count(schema.roles)}`);
    console.log(`perms      ${await db.$count(schema.permissions)}`);

    const expected = {
      elements: elementsJson.length,
      lessons: lessonsJson.length,
      quizzes: quizzesJson.length,
      questions: quizzesJson.reduce((n, q) => n + q.questions.length, 0),
    };

    const problems = await verifyContent(db);
    if (elementCount !== expected.elements)
      problems.unshift(
        `elements: expected ${expected.elements}, found ${elementCount}`,
      );
    if (lessonCount !== expected.lessons)
      problems.unshift(
        `lessons: expected ${expected.lessons}, found ${lessonCount}`,
      );
    if (quizCount !== expected.quizzes)
      problems.unshift(
        `quizzes: expected ${expected.quizzes}, found ${quizCount}`,
      );
    if (questionCount !== expected.questions)
      problems.unshift(
        `questions: expected ${expected.questions}, found ${questionCount}`,
      );
    if (unresolved > 0)
      problems.unshift(`${unresolved} question(s) have no correct option`);
    if (unmarked > 0)
      problems.unshift(
        `${unmarked} question(s) have no option marked is_correct — the answer-sync trigger did not run`,
      );

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
    await close();
  }
}

void main();
