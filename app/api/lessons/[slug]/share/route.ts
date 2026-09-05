import { getCurrentUser } from "@/lib/session";
import { recordActivity } from "@/lib/activity/record";
import { getEngagement, recordShare } from "@/db/queries/lessons-engagement";
import {
  SHARE_CHANNELS,
  isOutboundTarget,
  type ShareChannel,
} from "@/lib/share/share-lesson";
import { publishedLessonId } from "../_lesson";

/**
 * `POST` one share that actually happened.
 *
 * The client sends a CHANNEL, never a count and never a verified flag. The
 * server decides what counts — an `outbound_link` is stored and never counted,
 * because `window.open` to an intent URL cannot observe whether the other
 * origin's Post button was pressed. A client that could say "this one counts"
 * is a client that can inflate the number, which would defeat the point of
 * counting only verified shares at all.
 *
 * Anonymous shares are recorded with a null actor. They are real — a signed-out
 * reader can copy a link — and they fall outside the hourly dedupe index,
 * which needs a user id to deduplicate on, so they are never counted.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;

  const body = (await request.json().catch(() => null)) as {
    channel?: unknown;
    target?: unknown;
  } | null;

  const channel = body?.channel;
  if (
    typeof channel !== "string" ||
    !(SHARE_CHANNELS as readonly string[]).includes(channel)
  ) {
    return Response.json({ error: "unknown channel" }, { status: 400 });
  }

  // The target is stored, so it comes from the closed list or not at all —
  // otherwise the column becomes a record of whatever a caller typed.
  const rawTarget = body?.target;
  const target =
    typeof rawTarget === "string" && isOutboundTarget(rawTarget)
      ? rawTarget
      : null;

  const lessonId = await publishedLessonId(slug);
  if (!lessonId) return Response.json({ error: "not found" }, { status: 404 });

  const user = await getCurrentUser();

  await recordShare({
    lessonId,
    userId: user?.id ?? null,
    channel: channel as ShareChannel,
    target,
  });

  await recordActivity({
    verb: "lesson.shared",
    objectType: "lesson",
    objectId: slug,
    metadata: { channel, target },
  });

  return Response.json(await getEngagement(lessonId, user?.id ?? null));
}
