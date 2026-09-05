import { z } from "zod";

/**
 * What the browser sends when it subscribes.
 *
 * Validated rather than trusted, because these values are written into a table
 * and then used to build outbound HTTPS requests. An endpoint that is not an
 * absolute `https:` URL is either a broken client or somebody trying to make
 * the server fetch something on their behalf.
 *
 * Pure, so the same schema runs in the route handler and in tests.
 */

const httpsUrl = z.string().refine(
  (value) => {
    try {
      return new URL(value).protocol === "https:";
    } catch {
      return false;
    }
  },
  { message: "must be an absolute https: URL" },
);

/**
 * `p256dh` is an uncompressed P-256 point (65 bytes → 87–88 base64url chars)
 * and `auth` is 16 bytes (22 chars). The lengths are checked because a
 * truncated key produces a push that fails at ENCRYPTION time, inside the
 * send, far from the request that stored it.
 */
const base64url = (min: number, max: number) =>
  z
    .string()
    .regex(/^[A-Za-z0-9_-]+=*$/, { message: "must be base64url" })
    .refine((value) => value.length >= min && value.length <= max, {
      message: `must be ${min}–${max} characters`,
    });

export const subscriptionSchema = z.object({
  endpoint: httpsUrl,
  keys: z.object({
    p256dh: base64url(80, 100),
    auth: base64url(16, 32),
  }),
});

export type SubscriptionInput = z.infer<typeof subscriptionSchema>;

export const unsubscribeSchema = z.object({ endpoint: httpsUrl });
