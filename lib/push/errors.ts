/**
 * What a push service's response means, and what to do about it.
 *
 * Pure, and separated from the sending so the decisions can be tested against
 * every status code without a network or a mocked library. These are the rules
 * that keep the subscription table from filling with devices that will never
 * receive anything again.
 */

export type DeliveryOutcome =
  /** Delivered. */
  | { kind: "sent" }
  /**
   * The subscription is gone — the browser was uninstalled, the endpoint
   * rotated, the user revoked permission. The row is DELETED, not retried:
   * a 410 is the push service telling us this address is permanently dead,
   * and retrying it forever is how a table of live users becomes a table of
   * ghosts.
   */
  | { kind: "expired" }
  /** Worth trying again later. Carries how long to wait. */
  | { kind: "retry"; afterSeconds: number }
  /** Our fault and not fixable by retrying — a payload too large, a bad key. */
  | { kind: "failed"; reason: string };

/** Attempts before a delivery is abandoned. */
export const MAX_ATTEMPTS = 5;

/**
 * Consecutive non-fatal failures before a subscription is pruned.
 *
 * Higher than the per-delivery limit because it counts a DIFFERENT thing: a
 * device that failed one notification five times may just have been offline,
 * while one that has failed twenty in a row across days is not coming back.
 */
export const MAX_SUBSCRIPTION_FAILURES = 20;

/** Backoff, doubling, capped. A push nobody has received in an hour is not
 * more useful for arriving in two. */
export function backoffSeconds(attempts: number): number {
  return Math.min(60 * 60, 30 * 2 ** Math.max(0, attempts - 1));
}

export interface PushServiceError {
  statusCode?: number;
  headers?: Record<string, string | undefined>;
  message?: string;
}

/**
 * Reads a `web-push` error into a decision.
 *
 * `web-push` throws a `WebPushError` carrying the status code; anything with
 * no status at all is a network failure, which is retryable — the request may
 * never have reached the service.
 */
export function classify(error: PushServiceError): DeliveryOutcome {
  const status = error.statusCode;

  if (status === undefined) {
    return { kind: "retry", afterSeconds: 60 };
  }

  // 404: this endpoint was never valid or no longer resolves.
  // 410 Gone: the canonical "unsubscribed" answer.
  if (status === 404 || status === 410) return { kind: "expired" };

  if (status === 429) {
    return { kind: "retry", afterSeconds: retryAfter(error.headers) ?? 60 };
  }

  // Too big. Retrying sends the same oversized payload to the same service,
  // so this is a bug in whatever built it and must not consume attempts.
  if (status === 413) {
    return { kind: "failed", reason: "payload too large" };
  }

  // 400 and 403 mean our VAPID configuration is wrong — a mismatched key pair,
  // an invalid subject. Every subsequent send will fail identically until a
  // human fixes the configuration, so retrying is noise.
  if (status === 400 || status === 401 || status === 403) {
    return { kind: "failed", reason: `rejected with ${status}` };
  }

  if (status >= 500) {
    return { kind: "retry", afterSeconds: retryAfter(error.headers) ?? 60 };
  }

  return { kind: "failed", reason: `unexpected status ${status}` };
}

/** `Retry-After`, in seconds. Accepts the numeric form; an HTTP-date form
 * falls back to the caller's default rather than being mis-parsed as 0. */
function retryAfter(
  headers: Record<string, string | undefined> | undefined,
): number | null {
  const raw = headers?.["retry-after"] ?? headers?.["Retry-After"];
  if (!raw) return null;

  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);

  const date = Date.parse(raw);
  if (!Number.isNaN(date)) {
    return Math.max(0, Math.ceil((date - Date.now()) / 1000));
  }
  return null;
}
