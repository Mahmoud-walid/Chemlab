import { randomBytes } from "node:crypto";

/**
 * Where an upload goes, and what it is called.
 *
 * Both are chosen here, on the server, and then signed — see
 * `lib/media/signing.ts`. A client cannot influence either, which is what
 * makes the folder convention below a guarantee rather than a habit.
 */

/** The five things an asset can be. Decides the folder and the constraints. */
export const MEDIA_KINDS = [
  "avatars",
  "lessons",
  "exams",
  "elements",
  "pages",
] as const;

export type MediaKind = (typeof MEDIA_KINDS)[number];

/**
 * `chemlab/<environment>/<kind>/<yyyy>/<mm>/<entity>/<suffix>`
 *
 * The date segments keep any one folder browsable in Cloudinary's console —
 * a flat folder of ten thousand assets is not something a human can work in.
 *
 * The `environment` prefix is the part that matters operationally: it is what
 * lets a clean-up delete everything under `chemlab/preview-*` in one call
 * without going anywhere near production. It comes from the caller, which gets
 * it from `CLOUDINARY_UPLOAD_FOLDER`, and NEVER from `NODE_ENV` — a preview
 * deployment runs a production build and `NODE_ENV` reads "production" there,
 * which is precisely how a preview's uploads land in the production folder and
 * its clean-up takes real content with them.
 */
export function mediaFolder({
  environment,
  kind,
  entityId,
  now = new Date(),
}: {
  environment: string;
  kind: MediaKind;
  /** The lesson, question or user this belongs to. */
  entityId: string;
  now?: Date;
}): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `chemlab/${environment}/${kind}/${year}/${month}/${slug(entityId)}`;
}

/**
 * The file's own name within the folder: random, not the author's filename.
 *
 * Four separate reasons, none of them cosmetic. It cannot collide. It does not
 * publish `IMG_20260904_final_v3_REAL.jpg` to every reader. It sidesteps the
 * unicode and path-traversal questions that a name from a browser raises —
 * those bytes are arbitrary, and they are about to become part of a URL. And
 * it makes a draft lesson's images unguessable, which is the whole reason this
 * project does not need signed delivery URLs: the content is public once
 * published, and unlisted until then.
 *
 * 16 bytes of `randomBytes`, base64url. Not `Math.random`, which is not a
 * source of unguessable anything, and not a timestamp, which is a guess away.
 */
export function mediaSuffix(): string {
  return randomBytes(16).toString("base64url");
}

/** The full `public_id` Cloudinary stores: the folder and the name together. */
export function mediaPublicId(
  folder: string,
  suffix: string = mediaSuffix(),
): string {
  return `${folder}/${suffix}`;
}

/**
 * Narrows an id to what may appear in a path.
 *
 * The ids this receives are already ours — uuids and Better Auth ids — so in
 * practice nothing is stripped. It is here because "already ours" is a claim
 * about every future caller, and a path segment is not the place to find out
 * that one of them was wrong.
 */
function slug(value: string): string {
  const cleaned = value.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
  return cleaned.length > 0 ? cleaned : "unknown";
}

/**
 * Whether a public id belongs to this deployment's own tree.
 *
 * Used before anything destructive. A delete driven by a `public_id` that came
 * back from an API is a delete driven by a string, and the one mistake worth
 * making impossible is a preview deployment reclaiming production's assets.
 */
export function belongsToEnvironment(
  publicId: string,
  environment: string,
): boolean {
  return publicId.startsWith(`chemlab/${environment}/`);
}
