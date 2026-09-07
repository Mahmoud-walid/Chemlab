import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Cloudinary request signatures.
 *
 * Two directions, and they are not symmetric:
 *
 * - **Outgoing.** The browser uploads straight to Cloudinary, so the upload
 *   has to carry proof that this server authorised it. That proof is a hash
 *   over the parameters — which means the parameters are what is authorised.
 *   The folder, the public id and the resource type are chosen here and signed
 *   here; a client that alters any of them alters the hash and Cloudinary
 *   refuses the upload. That is the whole security model: not "the client is
 *   asked nicely to upload to this folder", but "no other folder is signed".
 *
 * - **Incoming.** Cloudinary signs its own responses and webhooks, and the
 *   confirm step verifies that signature before believing a word of the
 *   payload. Without it, "the upload finished, it is a 2 KB image" is a
 *   sentence anybody can POST.
 *
 * Pure and Node-only. It takes the secret as an argument rather than reading
 * the environment, so every case below is testable without one — and so a
 * caller cannot accidentally sign with a value it did not mean to.
 */

/** A parameter that can be signed. Cloudinary serialises everything as text. */
export type SignableValue = string | number | boolean;

/**
 * The string Cloudinary hashes.
 *
 * Its documented rule, and each clause matters: sort the parameters by name,
 * join as `k=v` with `&`, append the secret, SHA-1 the lot. Empty and
 * undefined values are dropped — Cloudinary drops them from the request too,
 * so signing them produces a hash of a request nobody sent.
 *
 * `file`, `api_key`, `resource_type` and `cloud_name` are excluded by
 * Cloudinary's own rule: they travel in the URL or the multipart body rather
 * than the signed parameter set. Signing one makes every upload fail with an
 * error that says nothing about why.
 */
const NEVER_SIGNED = new Set([
  "file",
  "api_key",
  "resource_type",
  "cloud_name",
  "signature",
]);

export function signaturePayload(
  params: Record<string, SignableValue | undefined | null>,
): string {
  return Object.keys(params)
    .filter((key) => !NEVER_SIGNED.has(key))
    .filter((key) => {
      const value = params[key];
      return value !== undefined && value !== null && value !== "";
    })
    .sort()
    .map((key) => `${key}=${String(params[key])}`)
    .join("&");
}

/**
 * SHA-1, because that is what Cloudinary verifies against.
 *
 * Not a judgement that SHA-1 is fine in general — it is broken for collision
 * resistance and would be the wrong choice for anything we controlled both
 * ends of. Here the other end is Cloudinary, the algorithm is theirs, and a
 * stronger hash computed locally is simply a signature they will reject. The
 * property this actually needs is that an attacker without the secret cannot
 * produce the digest, which is preimage resistance, and which SHA-1 still has.
 */
export function signParams(
  params: Record<string, SignableValue | undefined | null>,
  apiSecret: string,
): string {
  return createHash("sha1")
    .update(`${signaturePayload(params)}${apiSecret}`)
    .digest("hex");
}

/**
 * Verifies a signature Cloudinary produced — an upload response, or a webhook.
 *
 * Constant time. A `===` on a hex digest leaks, through timing, how many
 * leading characters were right, which turns forging one into guessing it a
 * character at a time. The length check first is not a leak: it is public how
 * long a SHA-1 hex digest is.
 */
export function verifySignature(
  params: Record<string, SignableValue | undefined | null>,
  signature: string,
  apiSecret: string,
): boolean {
  const expected = signParams(params, apiSecret);
  if (signature.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

/**
 * How long a signature this server issues stays usable.
 *
 * Cloudinary itself accepts a timestamp up to about an hour old. Ten minutes
 * is deliberately shorter: a signature is a bearer authorisation to write into
 * our account under a folder we chose, and the legitimate window between "the
 * editor asked to upload" and "the file started uploading" is seconds. An hour
 * is fifty extra minutes in which a signature captured from a log or a proxy
 * is still good.
 */
export const SIGNATURE_TTL_SECONDS = 600;

/** Whether a signature minted at `timestamp` (unix seconds) is still fresh. */
export function signatureIsFresh(
  timestamp: number,
  now: number = Math.floor(Date.now() / 1000),
): boolean {
  // Both ends. A timestamp in the future is not a slow client — clock skew of
  // a few seconds is normal, minutes of it is somebody choosing the number —
  // and accepting one would extend the window by however far ahead they set
  // it.
  const age = now - timestamp;
  return age >= -60 && age <= SIGNATURE_TTL_SECONDS;
}
