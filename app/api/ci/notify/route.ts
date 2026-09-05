import { getDb } from "@/db/client";
import {
  alreadyRecorded,
  optedInRecipients,
  previousOutcome,
  recordRun,
} from "@/db/queries/ci";
import {
  SIGNATURE_HEADER,
  ciNotifyPayloadSchema,
  isFresh,
  verifySignature,
} from "@/lib/ci/payload";
import { decideNotify } from "@/lib/ci/policy";
import { toPushPayload, toSlackMessage } from "@/lib/ci/render";
import { postToSlack } from "@/lib/ci/slack";
import { enqueueForUsers } from "@/lib/push/queue";
import { getServerEnv } from "@/lib/env.server";

/**
 * `POST /api/ci/notify` — the workflow telling the app what a run did.
 *
 * This endpoint is on the public internet, on the same deployment users hit.
 * Unauthenticated it would be a free spam cannon aimed at whoever opted in, so
 * the signature is checked BEFORE anything expensive happens: before the JSON
 * is parsed, before the database is touched.
 *
 * Every refusal answers a bare `401`. Telling a caller whether it was the
 * timestamp or the signature that failed is telling an attacker which half to
 * work on.
 */

export const dynamic = "force-dynamic";
// `node:crypto` for the HMAC, and the push queue underneath. Not edge.
export const runtime = "nodejs";

const unauthorized = () =>
  new Response(JSON.stringify({ error: "unauthorized" }), {
    status: 401,
    headers: { "content-type": "application/json" },
  });

export async function POST(request: Request) {
  const env = getServerEnv();
  const secret = env.CI_NOTIFY_SECRET;
  // No secret configured means no caller can be authenticated, so none is
  // trusted. Refusing everything is the safe default; accepting everything is
  // the one that ends in somebody's phone buzzing at 3 a.m. from a stranger.
  if (!secret) return unauthorized();

  // The RAW body, before parsing: the signature covers the bytes that were
  // sent, and re-serialising parsed JSON would change them.
  const body = await request.text();

  if (
    !verifySignature(body, request.headers.get(SIGNATURE_HEADER), secret).ok
  ) {
    return unauthorized();
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(body);
  } catch {
    return unauthorized();
  }

  const parsed = ciNotifyPayloadSchema.safeParse(parsedJson);
  if (!parsed.success) {
    // Signed but malformed is a different thing from unsigned: the caller
    // holds the secret, so it is our own workflow sending something wrong, and
    // it deserves a message it can act on.
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "invalid payload" },
      { status: 400 },
    );
  }

  const payload = parsed.data;

  // Replay: a captured body is worthless once the window closes, whether or
  // not it was ever seen before.
  if (!isFresh(payload.timestamp, new Date())) return unauthorized();

  const db = getDb();

  // GitHub retries deliveries, and a workflow can be re-run. The run URL
  // identifies the attempt, so a second delivery of one attempt is accepted
  // and does nothing — an idempotent 202 rather than a second buzz for a
  // failure the reader already saw.
  if (
    await alreadyRecorded(db, payload.repository, payload.runUrl, payload.job)
  ) {
    return Response.json(
      { pushed: 0, slack: "skipped", duplicate: true },
      { status: 202 },
    );
  }

  const previous = await previousOutcome(
    db,
    payload.repository,
    payload.branch,
    payload.job,
  );

  // Per recipient: two people can watch different branches and hold different
  // success policies, so "does this run notify?" has no single answer.
  const recipients = await optedInRecipients(db);
  const decisions = recipients.map((recipient) => ({
    userId: recipient.userId,
    decision: decideNotify(
      payload.outcome,
      previous,
      payload.branch,
      recipient.preferences,
    ),
  }));

  const targets = decisions.filter((entry) => entry.decision.notify);
  // A recovery for anybody is a recovery: the flag describes the RUN, not the
  // reader, and it only changes the wording.
  const recovery = targets.some((entry) => entry.decision.recovery);

  let pushed = 0;
  if (targets.length > 0) {
    const result = await enqueueForUsers(
      db,
      targets.map((entry) => entry.userId),
      toPushPayload(payload, recovery),
    );
    pushed = result.queued;
  }

  /**
   * Slack is not per recipient — it is a channel, and a channel has no
   * preferences. It follows the run's own policy: every failure, and a success
   * only when it is a recovery.
   */
  const slackWorthy =
    payload.outcome === "failure" ||
    (payload.outcome === "success" &&
      previous !== null &&
      previous !== "success");

  const slack = slackWorthy
    ? await postToSlack(
        env.SLACK_WEBHOOK_URL,
        toSlackMessage(payload, recovery),
      )
    : "skipped";

  // Recorded whatever happened, including when nobody was told: "why did
  // nobody get paged?" should be answerable from the table rather than by
  // re-reading the policy.
  await recordRun(db, payload, {
    notified: targets.length > 0 || slack === "sent",
    suppressionReason:
      targets.length > 0
        ? null
        : (decisions[0]?.decision.reason ?? "not-opted-in"),
    pushesQueued: pushed,
  });

  // 202, not 200: the pushes are queued, not delivered. The body is small and
  // specific so a CI log shows what happened without a second request.
  return Response.json({ pushed, slack, recovery }, { status: 202 });
}
