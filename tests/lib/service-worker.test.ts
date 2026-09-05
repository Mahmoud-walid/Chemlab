import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  decideClick,
  FALLBACK,
  resubscribeBody,
  toNotification,
} from "@/lib/push/service-worker-logic";

/**
 * The service worker's decisions.
 *
 * `public/sw.js` is served as-is and cannot import from `lib/`, so the rules
 * live in a tested module and the worker holds a copy. That duplication is
 * only safe if something checks the two still agree — the last block here does
 * exactly that, by asserting the worker handles the events and carries the
 * behaviours these tests pin down.
 */

const ORIGIN = "https://chemlab.test";

describe("toNotification", () => {
  it("renders a well-formed payload", () => {
    const spec = toNotification(
      JSON.stringify({
        title: "A reply",
        body: "Sara replied to your comment.",
        url: "/lessons/acids#comment-2",
        tag: "comment-2",
      }),
      ORIGIN,
    );

    expect(spec.title).toBe("A reply");
    expect(spec.data.url).toBe("/lessons/acids#comment-2");
    expect(spec.tag).toBe("comment-2");
  });

  it("falls back on an EMPTY push rather than throwing", () => {
    // Some push services send an empty push as a wake-up. A worker that throws
    // on one has a dead `push` handler for the rest of that event, and there
    // is no error surface inside it for anybody to notice.
    expect(toNotification(null, ORIGIN)).toEqual(FALLBACK);
    expect(toNotification("", ORIGIN)).toEqual(FALLBACK);
  });

  it("falls back on malformed JSON", () => {
    expect(toNotification("{not json", ORIGIN)).toEqual(FALLBACK);
  });

  it("falls back on a payload missing its text", () => {
    expect(toNotification(JSON.stringify({ title: "" }), ORIGIN)).toEqual(
      FALLBACK,
    );
  });

  it("refuses an off-origin click target", () => {
    // Re-checked in the worker even though the sender checks it: this is the
    // only check that runs on the machine doing the navigating.
    const spec = toNotification(
      JSON.stringify({
        title: "T",
        body: "B",
        url: "https://example.test/phish",
      }),
      ORIGIN,
    );
    expect(spec.data.url).toBe(`${ORIGIN}/`);
  });
});

describe("decideClick", () => {
  const url = "/lessons/acids";

  it("opens a window when nothing of ours is open", () => {
    expect(decideClick([], url, ORIGIN)).toEqual({ kind: "open", url });
  });

  it("focuses an existing tab rather than opening a second copy", () => {
    // A reader with Chemlab open who taps a notification should not end up
    // with two copies, one of which they close and lose their place in.
    const action = decideClick(
      [{ url: `${ORIGIN}/lessons`, focused: false }],
      url,
      ORIGIN,
    );
    expect(action).toEqual({ kind: "focus", index: 0, url });
  });

  it("prefers the tab the user is actually looking at", () => {
    const action = decideClick(
      [
        { url: `${ORIGIN}/a`, focused: false },
        { url: `${ORIGIN}/b`, focused: true },
      ],
      url,
      ORIGIN,
    );
    expect(action).toMatchObject({ kind: "focus", index: 1 });
  });

  it("ignores a window on somebody else's origin", () => {
    const action = decideClick(
      [{ url: "https://example.test/", focused: true }],
      url,
      ORIGIN,
    );
    expect(action).toEqual({ kind: "open", url });
  });
});

describe("resubscribeBody", () => {
  it("sends what the subscription endpoint expects", () => {
    const body = JSON.parse(
      resubscribeBody({
        endpoint: "https://push.test/abc",
        keys: { p256dh: "B".repeat(87), auth: "C".repeat(22) },
      }),
    ) as { endpoint: string; keys: { p256dh: string } };

    expect(body.endpoint).toBe("https://push.test/abc");
    expect(body.keys.p256dh).toHaveLength(87);
  });
});

describe("public/sw.js agrees with this module", () => {
  async function worker(): Promise<string> {
    return readFile(path.join(process.cwd(), "public", "sw.js"), "utf8");
  }

  it("handles every event the transport depends on", async () => {
    const source = await worker();
    // `pushsubscriptionchange` is the one that is easy to omit and whose
    // absence is silent: the browser rotates an endpoint, ours goes stale, and
    // the user simply stops receiving what they opted into.
    for (const event of [
      "install",
      "activate",
      "push",
      "notificationclick",
      "pushsubscriptionchange",
    ]) {
      expect(source, `sw.js handles ${event}`).toContain(
        `addEventListener("${event}"`,
      );
    }
  });

  it("takes over immediately instead of waiting for every tab to close", async () => {
    // A stale worker running indefinitely is the classic failure mode here.
    const source = await worker();
    expect(source).toContain("skipWaiting()");
    expect(source).toContain("clients.claim()");
  });

  it("guards the empty push and the off-origin URL", async () => {
    const source = await worker();
    // The two behaviours this file's tests pin down, present in the copy that
    // actually runs.
    expect(source).toContain("event.data ? event.data.text() : null");
    expect(source).toMatch(/resolved\.origin !== new URL\(origin\)\.origin/);
  });

  it("carries a version, so the running worker is identifiable", async () => {
    const source = await worker();
    expect(source).toMatch(/SW_VERSION = "\d+"/);
  });

  it("uses the same fallback text as the tested module", async () => {
    const source = await worker();
    expect(source).toContain(FALLBACK.title);
    expect(source).toContain(FALLBACK.body);
  });
});
