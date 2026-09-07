import { describe, expect, it } from "vitest";

import {
  belongsToEnvironment,
  mediaFolder,
  mediaPublicId,
  mediaSuffix,
} from "@/lib/media/paths";
import { checkUpload, MEDIA_CONSTRAINTS } from "@/lib/media/constraints";

/**
 * Where an upload goes, and what is allowed to go there.
 *
 * The folder convention is not tidiness. It is what makes "delete everything
 * this preview uploaded" a sentence that can be executed safely, and it only
 * works if every path is built the same way — so it is built in one function
 * and asserted here rather than assembled at each call site.
 */

const AT = new Date("2026-09-06T12:00:00Z");

describe("the folder", () => {
  it("puts the environment first, then the kind and the date", () => {
    expect(
      mediaFolder({
        environment: "production",
        kind: "lessons",
        entityId: "8f3c1d2e",
        now: AT,
      }),
    ).toBe("chemlab/production/lessons/2026/09/8f3c1d2e");
  });

  it("zero-pads the month, so a prefix query is a prefix", () => {
    // `2026/9` and `2026/09` do not sort together and do not match the same
    // prefix. One month of assets invisible to a clean-up is the failure.
    expect(
      mediaFolder({
        environment: "development",
        kind: "avatars",
        entityId: "u1",
        now: new Date("2026-01-31T23:00:00Z"),
      }),
    ).toContain("/2026/01/");
  });

  it("uses UTC, not the server's local time", () => {
    // Two servers in two regions would otherwise file the same upload under
    // different months, and the boundary is exactly when nobody is watching.
    expect(
      mediaFolder({
        environment: "development",
        kind: "avatars",
        entityId: "u1",
        now: new Date("2026-01-31T23:30:00Z"),
      }),
    ).toContain("/2026/01/");
  });

  it("strips anything that is not path-safe from the entity id", () => {
    // The ids this gets are already ours. This is about the caller that one
    // day is not — a path segment is not where you want to discover it.
    expect(
      mediaFolder({
        environment: "production",
        kind: "lessons",
        entityId: "../../../etc/passwd",
        now: AT,
      }),
    ).toBe("chemlab/production/lessons/2026/09/etcpasswd");
  });

  it("never produces an empty segment", () => {
    expect(
      mediaFolder({
        environment: "production",
        kind: "lessons",
        entityId: "///",
        now: AT,
      }),
    ).toBe("chemlab/production/lessons/2026/09/unknown");
  });
});

describe("the file name", () => {
  it("is random, not the author's filename", () => {
    // Four reasons at once: no collisions, no publishing
    // IMG_20260904_final_v3_REAL.jpg, no unicode or traversal questions from
    // browser-supplied bytes, and a draft lesson's images stay unguessable.
    const one = mediaSuffix();
    const two = mediaSuffix();
    expect(one).not.toBe(two);
    expect(one).toMatch(/^[A-Za-z0-9_-]{20,}$/);
  });

  it("joins onto the folder to make the public id", () => {
    expect(mediaPublicId("chemlab/dev/lessons/2026/09/x", "abc")).toBe(
      "chemlab/dev/lessons/2026/09/x/abc",
    );
  });
});

describe("the environment guard", () => {
  it("recognises this deployment's own tree", () => {
    expect(
      belongsToEnvironment(
        "chemlab/preview-pr-42/lessons/2026/09/x/a",
        "preview-pr-42",
      ),
    ).toBe(true);
  });

  it("refuses another environment's, which is the point", () => {
    // The one mistake worth making impossible: a preview deployment
    // reclaiming production's assets.
    expect(
      belongsToEnvironment(
        "chemlab/production/lessons/2026/09/x/a",
        "preview-pr-42",
      ),
    ).toBe(false);
  });

  it("is not fooled by a prefix that merely starts the same", () => {
    expect(
      belongsToEnvironment("chemlab/production-old/lessons/x", "production"),
    ).toBe(false);
  });
});

describe("what may be uploaded", () => {
  it("accepts an ordinary lesson image", () => {
    expect(
      checkUpload({ kind: "lessons", mimeType: "image/png", bytes: 1000 }),
    ).toMatchObject({ refusals: [] });
  });

  it("refuses SVG everywhere, deliberately", () => {
    // An SVG is XML, it can carry script, and it would be served from our own
    // delivery domain — a stored one is a stored XSS waiting for a reader to
    // open it directly. Recorded as Q42, not forgotten.
    for (const kind of [
      "lessons",
      "exams",
      "avatars",
      "elements",
      "pages",
    ] as const) {
      expect(
        checkUpload({ kind, mimeType: "image/svg+xml", bytes: 100 }).refusals,
      ).toEqual(["unsupported-type"]);
    }
  });

  it("refuses a file over the cap, naming the size and not the type", () => {
    expect(
      checkUpload({
        kind: "avatars",
        mimeType: "image/png",
        bytes: 5 * 1024 * 1024,
      }).refusals,
    ).toEqual(["too-large"]);
  });

  it("reports every reason at once, not the first", () => {
    // An author who fixes one refusal and is then told about the next has
    // been made to discover the rules one upload at a time — and an upload is
    // not a cheap round trip.
    expect(
      checkUpload({
        kind: "lessons",
        mimeType: "video/mp4",
        bytes: 500 * 1024 * 1024,
        durationSeconds: 4000,
      }).refusals,
    ).toEqual(["too-large", "too-long"]);
  });

  it("puts video behind its own permission everywhere it is allowed", () => {
    // Video is billed per rendition and per viewer: one lesson video watched
    // by a class can outweigh every image on the platform. "May add pictures"
    // must be grantable without it.
    for (const rules of Object.values(MEDIA_CONSTRAINTS)) {
      for (const rule of rules) {
        const isVideo = rule.mimeTypes.some((type) =>
          type.startsWith("video/"),
        );
        expect(rule.permission).toBe(
          isVideo ? "media:upload_video" : "media:create",
        );
      }
    }
  });

  it("caps every kind at something, so no rule is unbounded", () => {
    for (const rules of Object.values(MEDIA_CONSTRAINTS)) {
      expect(rules.length).toBeGreaterThan(0);
      for (const rule of rules) {
        expect(rule.maxBytes).toBeGreaterThan(0);
        expect(rule.mimeTypes.length).toBeGreaterThan(0);
      }
    }
  });
});
