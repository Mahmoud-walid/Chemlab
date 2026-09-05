import { z } from "zod";

/**
 * What the CI workflow posts, and how the app knows it really came from there.
 *
 * This endpoint lives on the public internet, on the same deployment users
 * hit. An unauthenticated `POST /api/ci/notify` is a free spam cannon aimed at
 * the maintainer's phone, so authentication is not optional — and it is a
 * SIGNATURE rather than a bearer token, for three concrete reasons:
 *
 * - A bearer token is replayable verbatim: anyone who ever sees one request
 *   can resend it for ever.
 * - It authenticates the CALLER and says nothing about the BODY, so a proxy
 *   that rewrites the payload still passes.
 * - It leaks by proximity — `curl -v`, retry logs, error reports, any HTTP
 *   debugging done while fixing the workflow — and a leaked value is
 *   immediately usable.
 *
 * The construction here is GitHub's own for webhooks: HMAC-SHA256 over the
 * RAW body, with a timestamp and a nonce inside the signed body so a captured
 * request expires and cannot be replayed.
 *
 * Pure apart from `node:crypto`, so every branch is testable without a
 * request.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export const CI_OUTCOMES = ["success", "failure", "cancelled"] as const;
export type CiOutcome = (typeof CI_OUTCOMES)[number];

/**
 * Which JOB failed, not which step.
 *
 * The issue was written when `ci.yml` had one job; it has five, running in
 * parallel. That changes what is worth reporting: with one job, "typecheck
 * failed" is the actionable unit, but with five the first question is which
 * job — and its log names the step. More than one can fail in the same run,
 * so this is a LIST: "verify, e2e failed" is one true sentence where two
 * notifications would be two half-truths racing each other into the tray.
 *
 * Free text rather than an enum, because the names live in `ci.yml` and a job
 * renamed there must not start failing validation on a run that is already
 * broken — the alert is most needed exactly when something is unusual.
 */
const jobName = z.string().min(1).max(40);

export const ciNotifyPayloadSchema = z.object({
  repository: z.string().min(1).max(140),
  branch: z.string().min(1).max(255),
  /** The full SHA. The short form is derived for display, never sent. */
  commitSha: z.string().regex(/^[0-9a-f]{40}$/, "expected a full commit sha"),
  /** Capped because it reaches a notification body, which is capped too. */
  commitMessage: z.string().max(200).default(""),
  actor: z.string().min(1).max(140),
  /**
   * Which workflow this is about — `ci` for `ci.yml`.
   *
   * Not the job: one run of the workflow produces ONE notification naming the
   * jobs that failed. Five jobs reporting separately would be five buzzes for
   * one push, four of them saying nothing new.
   */
  job: z.string().min(1).max(80).default("ci"),
  outcome: z.enum(CI_OUTCOMES),
  /** Empty on success. Capped, because a workflow that grows to fifty jobs
   * should not be able to grow the notification body past what a tray shows. */
  failedJobs: z.array(jobName).max(8).default([]),
  runUrl: z.url(),
  pullRequestNumber: z.number().int().positive().optional(),
  durationSeconds: z.number().int().nonnegative().max(86_400).optional(),
  /** Unix seconds. Rejected outside the freshness window below. */
  timestamp: z.number().int(),
  /** Random per request. The run URL is what actually deduplicates a retry;
   * this makes a captured body useless even before the window closes. */
  nonce: z.string().min(16).max(64),
});

export type CiNotifyPayload = z.infer<typeof ciNotifyPayloadSchema>;

/**
 * How stale a signed request may be.
 *
 * Five minutes is long enough for a slow runner and a retry, short enough
 * that a captured request is worthless by the time anyone finds it in a log.
 */
export const SIGNATURE_WINDOW_SECONDS = 300;

export const SIGNATURE_HEADER = "x-chemlab-signature";

/** `sha256=<hex>`, the same shape GitHub uses, so the prefix names the
 * algorithm and a future one can be added without ambiguity. */
export function signBody(body: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

export type SignatureFailure =
  "missing-signature" | "malformed-signature" | "bad-signature";

export interface SignatureCheck {
  ok: boolean;
  reason?: SignatureFailure;
}

/**
 * Constant-time comparison of the presented signature against ours.
 *
 * `===` on a secret-derived value leaks its length and its matching prefix
 * through timing. `timingSafeEqual` throws on a length mismatch, so the
 * length is checked first — and that check is safe, because the length of a
 * hex SHA-256 digest is public.
 */
export function verifySignature(
  body: string,
  presented: string | null,
  secret: string,
): SignatureCheck {
  if (!presented) return { ok: false, reason: "missing-signature" };
  if (!/^sha256=[0-9a-f]{64}$/.test(presented)) {
    return { ok: false, reason: "malformed-signature" };
  }

  const expected = Buffer.from(signBody(body, secret));
  const actual = Buffer.from(presented);
  if (expected.length !== actual.length) {
    return { ok: false, reason: "bad-signature" };
  }

  return timingSafeEqual(expected, actual)
    ? { ok: true }
    : { ok: false, reason: "bad-signature" };
}

/** Within the freshness window, in either direction — a runner's clock can be
 * ahead as easily as behind, and refusing the future would be a mystery. */
export function isFresh(
  timestamp: number,
  now: Date,
  windowSeconds: number = SIGNATURE_WINDOW_SECONDS,
): boolean {
  const skew = Math.abs(Math.floor(now.getTime() / 1000) - timestamp);
  return skew <= windowSeconds;
}

/** Seven characters, the length git itself abbreviates to. */
export function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

/** The first line only: a commit body would fill the notification and is
 * never the part that identifies the commit. */
export function commitSubject(message: string): string {
  return message.split("\n")[0]?.trim() ?? "";
}
