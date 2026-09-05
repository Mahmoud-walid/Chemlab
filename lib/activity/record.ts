import "server-only";
import { after } from "next/server";
import { headers } from "next/headers";

import { getDb } from "@/db/client";
import { activityEvents } from "@/db/schema/activity";
import { getSession } from "@/lib/session";
import { clientAddress, truncateIp } from "./ip";
import type { ActivityObjectType, ActivityVerb } from "./verbs";

/**
 * The one way an activity event is written.
 *
 * The actor and the request context are resolved HERE, from the session and
 * the headers, rather than taken from the caller. A call site that could pass
 * its own actor id is a call site that can be wrong about who did something —
 * by accident or otherwise — and an analytics stream nobody can trust is worse
 * than none.
 *
 * The write is scheduled with `after()`, so it happens once the response is
 * finished. #19 is explicit about why: **a failed analytics insert must never
 * fail a user's exam submission.** `after` also does not make a route dynamic,
 * which matters — the last two times something was added to a shared code path
 * here it silently cost 282 prerendered pages.
 *
 * One trap worth knowing: inside a STATIC page, `after` runs at build time, so
 * a `lesson.viewed` recorded from a prerendered lesson would count the build
 * rather than the reader. View events therefore belong in an explicitly
 * dynamic path, not in a page that prerenders.
 */

export interface ActivityInput {
  verb: ActivityVerb;
  objectType?: ActivityObjectType;
  objectId?: string | number | null;
  metadata?: Record<string, unknown>;
  /**
   * Overrides the session actor. For the two events that happen when there is
   * no session yet or no longer one — sign-up and sign-out — and for scripts.
   */
  actorId?: string | null;
}

export async function recordActivity(input: ActivityInput): Promise<void> {
  // Resolved before `after()`, because the request context is gone by the time
  // the callback runs. `after` defers the WRITE, not the reading of who did it.
  const context = await requestContext(input.actorId);

  const write = async () => {
    try {
      await getDb()
        .insert(activityEvents)
        .values({
          verb: input.verb,
          objectType: input.objectType ?? null,
          objectId:
            input.objectId === null || input.objectId === undefined
              ? null
              : String(input.objectId),
          metadata: input.metadata ?? null,
          ...context,
        });
    } catch (error) {
      // Swallowed on purpose, and loudly. Re-throwing here would surface as an
      // unhandled rejection in a background task, which in some hosts takes
      // the process down — for a missing analytics row.
      console.error("[activity] failed to record", input.verb, error);
    }
  };

  try {
    after(write);
  } catch {
    // `after` needs a request scope. A script or a test has none, and an
    // event recorded from a backfill is still an event — so fall back to
    // writing it inline rather than dropping it. The inline path is awaited,
    // which is the right trade off a request: nothing is waiting on it.
    await write();
  }
}

/** Actor, session and (truncated) request metadata, read from the request. */
async function requestContext(explicitActor?: string | null) {
  let actorId = explicitActor ?? null;
  let sessionId: string | null = null;

  try {
    const session = await getSession();
    if (session?.session) sessionId = session.session.id;
    // An explicit actor wins: sign-out has to name who signed out, and by then
    // the session is already gone.
    if (actorId === null) actorId = session?.user?.id ?? null;
  } catch {
    // No session, or no request scope. Anonymous is a real state, not a
    // failure — a signed-out visitor reading a lesson is exactly that.
  }

  let ipAddress: string | null = null;
  let userAgent: string | null = null;

  try {
    const requestHeaders = await headers();
    ipAddress = truncateIp(
      clientAddress(requestHeaders.get("x-forwarded-for")),
    );
    userAgent = requestHeaders.get("user-agent");
  } catch {
    // Called outside a request — a script, or a test.
  }

  return { actorId, sessionId, ipAddress, userAgent };
}
