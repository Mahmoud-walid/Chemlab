import { z } from "zod";

/**
 * What a push actually carries.
 *
 * One schema, shared by everything that sends: the product notifications of
 * #21 and the CI alerts of #24 both write this shape, and `public/sw.js` has
 * exactly one parser to maintain. Two senders inventing their own payloads is
 * two service-worker code paths, and the one nobody tested is the one that
 * throws inside a `push` event where no user will ever see the error.
 *
 * Pure: no `web-push`, no database, no `server-only`. The service worker's
 * pure helpers import it, and so do the tests.
 */

/**
 * The limits are the push services', not ours. A payload is encrypted before
 * transmission and the ciphertext must fit roughly 4 KB; the practical
 * guidance is to stay under ~3 KB of plaintext. A title and body long enough
 * to exceed that would be truncated by the OS anyway — no notification tray
 * shows 240 characters — so the caps are where the text stops being readable
 * rather than where the transport stops working.
 */
export const TITLE_MAX = 80;
export const BODY_MAX = 240;

/** Roughly the safe plaintext budget. Enforced, because a 413 from the push
 * service arrives long after the code that built the payload has returned. */
export const PAYLOAD_MAX_BYTES = 3_000;

export const notificationPayloadSchema = z.object({
  title: z.string().min(1).max(TITLE_MAX),
  body: z.string().min(1).max(BODY_MAX),
  icon: z.string().default("/icons/icon-192.png"),
  badge: z.string().default("/icons/badge-72.png"),
  /**
   * Where `notificationclick` goes. A path, or an absolute URL on our own
   * origin — never an arbitrary one: a notification is a trusted surface, and
   * a payload that could open any URL turns whoever can enqueue one into
   * whoever can send your users anywhere.
   */
  url: z.string().default("/"),
  /**
   * Dedup key. A second notification with the same tag REPLACES the first in
   * the tray instead of stacking — this is how "3 new replies" collapses into
   * one line rather than three.
   */
  tag: z.string().max(64).optional(),
  /** Whether replacing a tagged notification should alert again. Default off:
   * an updated count is not worth a second buzz. */
  renotify: z.boolean().default(false),
  data: z.record(z.string(), z.unknown()).default({}),
});

export type NotificationPayload = z.infer<typeof notificationPayloadSchema>;

/** Parsed and defaulted, or an error naming the field. */
export function parsePayload(value: unknown): NotificationPayload {
  return notificationPayloadSchema.parse(value);
}

/** The size a push service will actually see, before encryption overhead. */
export function payloadBytes(payload: NotificationPayload): number {
  return new TextEncoder().encode(JSON.stringify(payload)).length;
}

export function isWithinSizeLimit(payload: NotificationPayload): boolean {
  return payloadBytes(payload) <= PAYLOAD_MAX_BYTES;
}

/**
 * Resolves the click target against our own origin, refusing anything else.
 *
 * A notification looks like it came from the site, so a payload that could
 * carry `https://example.test/` would be a phishing primitive handed to
 * whoever can enqueue a delivery. Anything off-origin — or unparseable —
 * becomes the home page rather than being followed.
 */
export function safeNotificationUrl(url: string, origin: string): string {
  try {
    const resolved = new URL(url, origin);
    const base = new URL(origin);
    if (resolved.origin !== base.origin) return base.origin + "/";
    return resolved.pathname + resolved.search + resolved.hash;
  } catch {
    return "/";
  }
}
