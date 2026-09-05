import { eq } from "drizzle-orm";

import { getDb } from "@/db/client";
import { lessons } from "@/db/schema/content";
import { recordActivity } from "@/lib/activity/record";

/**
 * `POST /api/lessons/[slug]/view` — one lesson view.
 *
 * Exists so the lesson page can stay prerendered: `after()` inside a static
 * page runs at build time, so recording the view there would count the build
 * rather than the reader.
 *
 * The slug is checked against the table before anything is recorded. Without
 * that, this endpoint writes an activity row for any string anyone posts, and
 * the "most-read lessons" chart becomes a list of whatever an attacker typed.
 *
 * Anonymous views are recorded with a null actor — `recordActivity` resolves
 * the actor from the session, so a signed-out reader is counted without being
 * identified.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;

  const [lesson] = await getDb()
    .select({ id: lessons.id, status: lessons.status })
    .from(lessons)
    .where(eq(lessons.slug, slug))
    .limit(1);

  // 204 either way. A different answer for an unknown slug would turn this
  // into a way to enumerate unpublished lessons, and the caller has nothing
  // to do with the result in any case.
  if (lesson && lesson.status === "published") {
    await recordActivity({
      verb: "lesson.viewed",
      objectType: "lesson",
      objectId: slug,
    });
  }

  return new Response(null, { status: 204 });
}
