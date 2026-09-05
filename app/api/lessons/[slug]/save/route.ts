import { getCurrentUser } from "@/lib/session";
import { recordActivity } from "@/lib/activity/record";
import {
  getEngagement,
  saveLesson,
  unsaveLesson,
} from "@/db/queries/lessons-engagement";
import { publishedLessonId } from "../_lesson";

/**
 * `POST` to save, `DELETE` to unsave.
 *
 * A save is private: it appears on the owner's reading list and nowhere else.
 * The response therefore carries the viewer's own state and the counts, but
 * `saveCount` is never rendered publicly — see the schema for why.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  return toggle(await params, "save");
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  return toggle(await params, "unsave");
}

async function toggle({ slug }: { slug: string }, action: "save" | "unsave") {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "sign in" }, { status: 401 });

  const lessonId = await publishedLessonId(slug);
  if (!lessonId) return Response.json({ error: "not found" }, { status: 404 });

  if (action === "save") {
    await saveLesson(lessonId, user.id);
  } else {
    await unsaveLesson(lessonId, user.id);
  }

  await recordActivity({
    verb: "lesson.saved",
    objectType: "lesson",
    objectId: slug,
    metadata: { saved: action === "save" },
  });

  return Response.json(await getEngagement(lessonId, user.id));
}
