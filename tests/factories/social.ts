import * as schema from "@/db/schema";
import { createComment as writeComment } from "@/db/queries/comments";
import type { SeedDatabase } from "@/db/seed/connect";

/**
 * A comment, written through the real writer.
 *
 * Not a direct insert: `comments` carries threading columns — `path`, `depth`,
 * `root_id` — that the schema requires and that only the writer knows how to
 * fill. A hand-rolled insert either violates a NOT NULL (which is the good
 * outcome, because it fails immediately) or produces a row shaped unlike
 * anything the application would ever write, which is the bad one.
 */
export async function createComment(
  db: SeedDatabase,
  input: {
    subjectId: string;
    authorId: string;
    body?: string;
    parentId?: string;
  },
): Promise<{ id: string; depth: number; parentId: string | null }> {
  return writeComment(db, {
    subjectType: "lesson",
    subjectId: input.subjectId,
    authorId: input.authorId,
    body: input.body ?? "A comment from a test factory.",
    ...(input.parentId ? { parentId: input.parentId } : {}),
  });
}

/** Somebody kept this lesson. Enough to make it un-erasable. */
export async function saveLesson(
  db: SeedDatabase,
  lessonId: string,
  userId: string,
): Promise<void> {
  await db
    .insert(schema.lessonSaves)
    .values({ lessonId, userId })
    .onConflictDoNothing();
}

export async function likeLesson(
  db: SeedDatabase,
  lessonId: string,
  userId: string,
): Promise<void> {
  await db
    .insert(schema.lessonLikes)
    .values({ lessonId, userId })
    .onConflictDoNothing();
}
