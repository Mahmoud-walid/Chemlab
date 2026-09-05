import { getEngagement } from "@/db/queries/lessons-engagement";
import { getCurrentUser } from "@/lib/session";
import { publishedLessonId } from "../_lesson";

/**
 * `GET` the counts, and the viewer's own liked/saved state.
 *
 * Exists because the lesson page is PRERENDERED. A count rendered on the
 * server would be the count at build time — wrong by the first like, and wrong
 * in a way that looks authoritative. Fetching on mount also gets a signed-in
 * reader their own state without making the page dynamic and costing every
 * lesson its prerender.
 *
 * `no-store`: the response depends on who is asking.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;

  const lessonId = await publishedLessonId(slug);
  if (!lessonId) return Response.json({ error: "not found" }, { status: 404 });

  const user = await getCurrentUser();
  const state = await getEngagement(lessonId, user?.id ?? null);

  return Response.json(state, {
    headers: { "cache-control": "no-store, private" },
  });
}
