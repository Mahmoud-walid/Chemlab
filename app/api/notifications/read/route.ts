import { getDb } from "@/db/client";
import { markRead, unreadCount } from "@/db/queries/notifications";
import { requireUserOr401 } from "@/lib/session";

/**
 * `POST /api/notifications/read` — mark one, several, or all read.
 *
 * Scoped to the caller's own rows by the query itself, so passing somebody
 * else's notification id changes nothing rather than being refused with a
 * message that confirms the id exists.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const { user, response } = await requireUserOr401();
  if (response) return response;

  const body = (await request.json().catch(() => null)) as {
    ids?: unknown;
    all?: unknown;
  } | null;

  const all = body?.all === true;
  const ids =
    Array.isArray(body?.ids) &&
    body.ids.every((value) => typeof value === "string")
      ? (body.ids as string[])
      : null;

  if (!all && (!ids || ids.length === 0)) {
    return Response.json({ error: "pass ids, or all: true" }, { status: 400 });
  }

  const db = getDb();
  const changed = await markRead(db, user.id, all ? "all" : ids!);

  return Response.json({
    changed,
    unread: await unreadCount(db, user.id),
  });
}
