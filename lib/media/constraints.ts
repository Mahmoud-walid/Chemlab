import type { MediaKind } from "./paths";

/**
 * What may be uploaded, decided on the server before a signature exists.
 *
 * The client checks these too, and its check is advisory: it exists to say
 * "that file is too big" before a ten-minute upload rather than after. The
 * server's copy is the one that decides, and Cloudinary's upload preset should
 * mirror it a third time — so a client that skips our UI entirely is still
 * refused by Cloudinary itself.
 */

export interface MediaConstraint {
  /** Exact MIME types. Not a prefix match: `image/*` would admit `image/svg+xml`
   * along with everything else a browser has ever called an image. */
  mimeTypes: readonly string[];
  maxBytes: number;
  /** Video only. A ten-minute cap is a bandwidth decision, not a quality one. */
  maxDurationSeconds?: number;
  /** The permission a caller must hold. Video is separate from images because
   * its cost profile is entirely different — transcoding is billed per
   * rendition and streaming is billed per viewer. */
  permission: string;
}

const MB = 1024 * 1024;

/**
 * SVG is absent, and that is the decision rather than an oversight.
 *
 * An SVG is XML, it can carry script, and it is served from our own delivery
 * domain — so a stored one is a stored cross-site scripting payload waiting
 * for a reader to open it directly. Cloudinary offers sanitisation, but the
 * safe default is not to accept the format at all; recorded as Q42 in case the
 * lesson authors turn out to need vector diagrams.
 */
export const MEDIA_CONSTRAINTS: Record<MediaKind, MediaConstraint[]> = {
  avatars: [
    {
      mimeTypes: ["image/jpeg", "image/png", "image/webp"],
      maxBytes: 2 * MB,
      permission: "media:create",
    },
  ],
  lessons: [
    {
      mimeTypes: ["image/jpeg", "image/png", "image/webp", "image/gif"],
      maxBytes: 10 * MB,
      permission: "media:create",
    },
    {
      mimeTypes: ["video/mp4", "video/webm", "video/quicktime"],
      maxBytes: 200 * MB,
      maxDurationSeconds: 600,
      permission: "media:upload_video",
    },
  ],
  exams: [
    {
      mimeTypes: ["image/jpeg", "image/png", "image/webp", "image/gif"],
      maxBytes: 10 * MB,
      permission: "media:create",
    },
    {
      mimeTypes: ["video/mp4", "video/webm", "video/quicktime"],
      maxBytes: 200 * MB,
      maxDurationSeconds: 600,
      permission: "media:upload_video",
    },
  ],
  elements: [
    {
      mimeTypes: ["image/jpeg", "image/png", "image/webp"],
      maxBytes: 10 * MB,
      permission: "media:create",
    },
  ],
  pages: [
    {
      mimeTypes: ["image/jpeg", "image/png", "image/webp", "image/gif"],
      maxBytes: 10 * MB,
      permission: "media:create",
    },
  ],
};

/** Why an upload was refused. A code, so the message is translated once. */
export type MediaRefusal =
  "unsupported-type" | "too-large" | "too-long" | "unknown-kind";

export interface MediaRequest {
  kind: MediaKind;
  mimeType: string;
  bytes: number;
  /** Video only, and only when the client knows it. Absent is not a pass:
   * Cloudinary reports the real duration on confirm, and that is where a file
   * that lied gets rejected. */
  durationSeconds?: number;
}

export interface MediaVerdict {
  refusals: MediaRefusal[];
  /** The matched rule, when the type is one we accept. Carries the permission
   * the caller has to hold. */
  constraint?: MediaConstraint;
}

/**
 * Every reason at once, not the first.
 *
 * An author who fixes one refusal and is then told about the next has been
 * made to discover the rules one upload at a time — and an upload is not a
 * cheap round trip.
 */
export function checkUpload(request: MediaRequest): MediaVerdict {
  const rules = MEDIA_CONSTRAINTS[request.kind];
  if (!rules) return { refusals: ["unknown-kind"] };

  const constraint = rules.find((rule) =>
    rule.mimeTypes.includes(request.mimeType),
  );
  if (!constraint) return { refusals: ["unsupported-type"] };

  const refusals: MediaRefusal[] = [];
  if (request.bytes > constraint.maxBytes) refusals.push("too-large");
  if (
    constraint.maxDurationSeconds !== undefined &&
    request.durationSeconds !== undefined &&
    request.durationSeconds > constraint.maxDurationSeconds
  ) {
    refusals.push("too-long");
  }

  return { refusals, constraint };
}
