import "server-only";
import webpush from "web-push";

import type { SeedDatabase } from "@/db/seed/connect";
import { getServerEnv } from "@/lib/env.server";
import { env } from "@/lib/env";
import { pushConfigured } from "@/lib/env.server.schema";
import {
  backoffSeconds,
  classify,
  MAX_ATTEMPTS,
  MAX_SUBSCRIPTION_FAILURES,
  type PushServiceError,
} from "./errors";
import {
  claimDue,
  failExhausted,
  markExpired,
  markFailed,
  markRetry,
  markSent,
  pruneFailedSubscriptions,
  type ClaimedDelivery,
} from "./queue";

/**
 * Actually sending.
 *
 * The only module that talks to `web-push`, so everything else — the queue,
 * the classification of a failure, the payload shape — is testable without a
 * network. This one is thin on purpose: fetch a batch, send each, record what
 * happened.
 */

export interface DrainResult {
  attempted: number;
  sent: number;
  expired: number;
  retried: number;
  failed: number;
  prunedSubscriptions: number;
}

/** Configures `web-push` from the environment, once per process. */
function configure(): boolean {
  const server = getServerEnv();
  const publicKey = env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

  if (!pushConfigured(server, publicKey)) return false;

  webpush.setVapidDetails(
    server.VAPID_SUBJECT!,
    publicKey!,
    server.VAPID_PRIVATE_KEY!,
  );
  return true;
}

/**
 * Sends one delivery. Exported so a test can drive it with a mocked sender,
 * and so the drain reads as a loop over decisions rather than a loop over
 * try/catch.
 */
export async function deliver(
  delivery: ClaimedDelivery,
  send: typeof webpush.sendNotification = webpush.sendNotification,
): Promise<ReturnType<typeof classify>> {
  try {
    await send(
      {
        endpoint: delivery.endpoint,
        keys: { p256dh: delivery.p256dh, auth: delivery.auth },
      },
      JSON.stringify(delivery.payload),
    );
    return { kind: "sent" };
  } catch (error) {
    return classify(error as PushServiceError);
  }
}

/**
 * Drains one batch.
 *
 * Failures are handled per delivery: one dead endpoint must not stop the other
 * ninety-nine from being sent, which is exactly what an unhandled throw in a
 * loop would do.
 */
export async function drain(
  db: SeedDatabase,
  options: {
    now?: Date;
    limit?: number;
    send?: typeof webpush.sendNotification;
  } = {},
): Promise<DrainResult> {
  const send = options.send;

  // The mocked sender in tests needs no VAPID configuration; a real send does,
  // and refusing early beats a run of identical 401s from the push service.
  if (!send && !configure()) {
    throw new Error(
      "Web Push is not configured. Set NEXT_PUBLIC_VAPID_PUBLIC_KEY, " +
        "VAPID_PRIVATE_KEY and VAPID_SUBJECT (see `pnpm vapid:keys`).",
    );
  }

  const due = await claimDue(db, options.now ?? new Date(), options.limit);

  const result: DrainResult = {
    attempted: due.length,
    sent: 0,
    expired: 0,
    retried: 0,
    failed: 0,
    prunedSubscriptions: 0,
  };

  for (const delivery of due) {
    const outcome = await deliver(delivery, send);

    switch (outcome.kind) {
      case "sent":
        await markSent(db, delivery.id, delivery.subscriptionId);
        result.sent += 1;
        break;

      case "expired":
        await markExpired(db, delivery.subscriptionId);
        result.expired += 1;
        break;

      case "retry":
        if (delivery.attempts + 1 >= MAX_ATTEMPTS) {
          // Out of attempts. Recorded as failed rather than retried forever:
          // a queue that never gives up is a queue that never drains.
          await markFailed(db, delivery.id, "attempts exhausted");
          result.failed += 1;
        } else {
          await markRetry(
            db,
            delivery.id,
            delivery.subscriptionId,
            Math.max(
              outcome.afterSeconds,
              backoffSeconds(delivery.attempts + 1),
            ),
            "retryable failure",
          );
          result.retried += 1;
        }
        break;

      case "failed":
        await markFailed(db, delivery.id, outcome.reason);
        result.failed += 1;
        break;
    }
  }

  await failExhausted(db, MAX_ATTEMPTS);
  result.prunedSubscriptions = await pruneFailedSubscriptions(
    db,
    MAX_SUBSCRIPTION_FAILURES,
  );

  return result;
}
