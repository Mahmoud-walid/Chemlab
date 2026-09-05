import { getDb } from "@/db/client";
import { heartbeat } from "@/db/queries/presence";
import { requireUserOr401 } from "@/lib/session";

/**
 * `POST /api/presence/beat` — "I am still here".
 *
 * Fire-and-forget by design. It answers 204 with no body, and the write is
 * conditional, so a duplicate beat costs nothing. Nothing about a failed
 * heartbeat should ever reach the reader: a toast saying "could not update
 * presence" is noise about a green dot.
 *
 * Accepts `sendBeacon`, which cannot set a content type reliably and cannot
 * read a response — hence 204 and a body parsed leniently.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Route PATTERNS only. A path with a query string can carry anything the URL
 * carried, which for a search page is what somebody typed. */
const SAFE_PATH = /^\/[A-Za-z0-9\-_/[\]().]{0,120}$/;

export async function POST(request: Request) {
  const { user, response } = await requireUserOr401();
  if (response) return response;

  const body = (await request.json().catch(() => null)) as {
    path?: unknown;
  } | null;

  const raw = typeof body?.path === "string" ? body.path : null;
  // Refused rather than trimmed: a path that does not look like a route
  // pattern is a caller sending something else, and storing it would be
  // storing whatever they sent.
  const path = raw && SAFE_PATH.test(raw) ? raw : null;

  await heartbeat(getDb(), user.id, path);

  // No body: `sendBeacon` cannot read one, and there is nothing a client would
  // do with the answer.
  return new Response(null, { status: 204 });
}
