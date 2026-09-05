import { getDb } from "@/db/client";
import { listReplies } from "@/db/queries/comments";
import { pageSize } from "@/lib/comments/cursor";
import { getCurrentUser } from "@/lib/session";

/**
 * The rest of one thread's replies.
 *
 * A separate route because a thread pages independently of the feed: opening
 * "show 40 more replies" must not re-fetch the page of roots around it, and a
 * long thread must not make the feed's own page unbounded.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const url = new URL(request.url);
  const cursor = url.searchParams.get("cursor");

  if (cursor !== null && cursor.length > 512) {
    return Response.json({ error: "bad cursor" }, { status: 400 });
  }

  const viewer = await getCurrentUser();

  return Response.json(
    await listReplies(getDb(), id, {
      cursor,
      limit: pageSize(url.searchParams.get("limit")),
      viewerId: viewer?.id ?? null,
    }),
    { headers: { "cache-control": "no-store, private" } },
  );
}
