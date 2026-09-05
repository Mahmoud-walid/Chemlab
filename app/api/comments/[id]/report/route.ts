import { z } from "zod";

import { getDb } from "@/db/client";
import { commentById, reportComment } from "@/db/queries/comments";
import { requireUserOr401 } from "@/lib/session";

/**
 * Reporting a comment.
 *
 * Answers the same 202 whether or not a report already existed. Telling a
 * reporter "you already reported this" is no use to them, and telling them
 * anything about what happened next would make the queue's state readable by
 * whoever wants to know if their target is under review.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const REASONS = ["spam", "abuse", "off-topic", "wrong", "other"] as const;

const schema = z.object({
  reason: z.enum(REASONS),
  note: z.string().max(500).optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, response } = await requireUserOr401();
  if (response) return response;

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "unknown reason" }, { status: 400 });
  }

  const { id } = await params;
  const db = getDb();

  const comment = await commentById(db, id);
  if (!comment) return Response.json({ error: "not found" }, { status: 404 });

  await reportComment(db, id, user.id, parsed.data.reason, parsed.data.note);
  return Response.json({ ok: true }, { status: 202 });
}
