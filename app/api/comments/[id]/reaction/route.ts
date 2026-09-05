import { z } from "zod";

import { getDb } from "@/db/client";
import { commentById, react } from "@/db/queries/comments";
import { requireUserOr401 } from "@/lib/session";

/**
 * A reader's like or dislike on one comment.
 *
 * `PUT` sets or switches, `DELETE` clears. Idempotent by construction: the
 * request names the state it wants, not a change to apply, so a double-tap and
 * a retry both land on the same row rather than toggling twice.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const schema = z.object({ type: z.enum(["like", "dislike"]) });

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, response } = await requireUserOr401();
  if (response) return response;

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "like or dislike" }, { status: 400 });
  }

  const { id } = await params;
  const db = getDb();

  // Checked before writing: a foreign-key violation would answer 500 for what
  // is a client sending a stale id after a comment was deleted.
  const comment = await commentById(db, id);
  if (!comment || comment.deletedAt !== null) {
    return Response.json({ error: "not found" }, { status: 404 });
  }

  await react(db, id, user.id, parsed.data.type);
  return Response.json({ ok: true });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, response } = await requireUserOr401();
  if (response) return response;

  const { id } = await params;
  // No existence check: clearing a reaction on a comment that is already gone
  // is the state the caller asked for.
  await react(getDb(), id, user.id, null);
  return Response.json({ ok: true });
}
