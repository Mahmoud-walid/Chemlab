import "server-only";
import { and, eq, isNull } from "drizzle-orm";

import { getDb } from "@/db/client";
import { lessons } from "@/db/schema/content";

/**
 * Resolves a slug to a published lesson id.
 *
 * Every engagement route starts here rather than trusting the slug. Without
 * it these endpoints write a row for any string anyone posts, and a lesson
 * that is a draft — or soft-deleted — collects likes it should not have.
 */
export async function publishedLessonId(slug: string): Promise<string | null> {
  const [lesson] = await getDb()
    .select({ id: lessons.id })
    .from(lessons)
    .where(
      and(
        eq(lessons.slug, slug),
        eq(lessons.status, "published"),
        isNull(lessons.deletedAt),
      ),
    )
    .limit(1);

  return lesson?.id ?? null;
}
