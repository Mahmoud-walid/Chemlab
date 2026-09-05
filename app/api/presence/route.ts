import { getDb } from "@/db/client";
import { presenceFor } from "@/db/queries/presence";
import { MAX_PRESENCE_IDS } from "@/lib/presence/constants";
import { can } from "@/lib/authz";

/**
 * `GET /api/presence?userIds=a,b,c` — presence for a batch of people.
 *
 * Batched because a page of forty comment avatars must issue ONE request. Forty
 * requests is forty round trips and forty queries against a table every online
 * user is writing to, for forty dots.
 *
 * Readable without a session: the dot appears beside public comments, and
 * hiding the whole feature from signed-out readers would make the comment list
 * look different depending on who is looking, for no privacy gain — somebody
 * who wants their presence private sets it to `nobody`, which is enforced in
 * SQL for everybody including admins' own reads.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const raw = url.searchParams.get("userIds") ?? "";
  const userIds = raw
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  if (userIds.length === 0) {
    return Response.json(
      { rows: [] },
      { headers: { "cache-control": "no-store" } },
    );
  }

  // A cap, not a truncation: silently answering for the first hundred of two
  // hundred ids would make a page render half its dots and look broken rather
  // than tell the caller it asked for too much.
  if (userIds.length > MAX_PRESENCE_IDS) {
    return Response.json(
      { error: `at most ${MAX_PRESENCE_IDS} ids` },
      { status: 400 },
    );
  }

  // The coarse path is an admin's extra. Everybody else gets state and a
  // timestamp — and somebody hidden gets neither.
  const includePath = await can("user:read");

  return Response.json(
    { rows: await presenceFor(getDb(), userIds, { includePath }) },
    // Per-viewer (the path) and stale within seconds.
    { headers: { "cache-control": "no-store, private" } },
  );
}
