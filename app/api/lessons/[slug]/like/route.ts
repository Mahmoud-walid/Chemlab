import { getCurrentUser } from "@/lib/session";
import { recordActivity } from "@/lib/activity/record";
import {
  getEngagement,
  likeLesson,
  unlikeLesson,
} from "@/db/queries/lessons-engagement";
import { publishedLessonId } from "../_lesson";

/**
 * `POST` to like, `DELETE` to unlike.
 *
 * Both are idempotent, and the idempotency is the database's: liking twice
 * inserts once because of the composite primary key, so a double-tap or a
 * replayed request cannot double-count. The response carries the count the
 * caller should now show, so an optimistic UI has something authoritative to
 * settle on rather than keeping its own guess.
 *
 * 401 for a signed-out reader rather than a silent no-op: the click was real,
 * and the UI turns that into a sign-in prompt instead of a like that appears
 * to work and vanishes on reload.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  return toggle(await params, "like");
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  return toggle(await params, "unlike");
}

async function toggle({ slug }: { slug: string }, action: "like" | "unlike") {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: "sign in" }, { status: 401 });
  }

  const lessonId = await publishedLessonId(slug);
  if (!lessonId) return Response.json({ error: "not found" }, { status: 404 });

  if (action === "like") {
    await likeLesson(lessonId, user.id);
  } else {
    await unlikeLesson(lessonId, user.id);
  }

  await recordActivity({
    verb: action === "like" ? "lesson.liked" : "lesson.unliked",
    objectType: "lesson",
    objectId: slug,
  });

  // Read AFTER the write, so the number is the trigger's rather than an
  // increment computed here — the two can only disagree if something is wrong,
  // and this way the reader sees the truth.
  const state = await getEngagement(lessonId, user.id);
  return Response.json(state);
}
