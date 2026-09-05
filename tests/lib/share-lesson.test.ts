import { describe, expect, it, vi } from "vitest";

import {
  copyLink,
  isCounted,
  isOutboundTarget,
  outboundUrl,
  shareLesson,
  type ShareEnvironment,
} from "@/lib/share/share-lesson";

/**
 * The share-counting rules, which are the point of the feature.
 *
 * #20's requirement, restated: a share counts when it HAPPENS, not when the
 * button is pressed. These tests are the specification of that — most of them
 * assert that something is NOT counted.
 */

const REQUEST = {
  title: "Introduction / Basics",
  url: "https://chemlab.test/lessons/introduction-basics",
};

function abort(): Error {
  const error = new Error("Share canceled");
  error.name = "AbortError";
  return error;
}

describe("shareLesson", () => {
  it("counts a share sheet that resolves", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const result = await shareLesson(REQUEST, { share });

    expect(result).toEqual({ outcome: "shared", channel: "web_share" });
    expect(isCounted(result)).toBe(true);
    expect(share).toHaveBeenCalledWith(REQUEST);
  });

  it("does NOT count a dismissed share sheet", async () => {
    // The exact case the requirement calls out: the sheet opened and the user
    // changed their mind. A counter that increments here is a click counter.
    const writeText = vi.fn().mockResolvedValue(undefined);
    const result = await shareLesson(REQUEST, {
      share: vi.fn().mockRejectedValue(abort()),
      writeText,
    });

    expect(result).toEqual({ outcome: "dismissed", channel: "web_share" });
    expect(isCounted(result)).toBe(false);
    // And it does not quietly copy the link instead: the user said no, and
    // overwriting their clipboard afterwards would both count a share they
    // declined and throw away whatever they had copied.
    expect(writeText).not.toHaveBeenCalled();
  });

  it("recognises an AbortError that is not a DOMException", async () => {
    // Safari has shipped plain Errors carrying the name. Missing one turns a
    // dismissal into a counted share.
    const plain = { name: "AbortError" };
    const result = await shareLesson(REQUEST, {
      share: vi.fn().mockRejectedValue(plain),
      writeText: vi.fn(),
    });
    expect(result.outcome).toBe("dismissed");
  });

  it("falls back to the clipboard when the sheet fails for another reason", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const result = await shareLesson(REQUEST, {
      share: vi.fn().mockRejectedValue(new Error("NotAllowedError")),
      writeText,
    });

    expect(result).toEqual({ outcome: "shared", channel: "clipboard" });
    expect(writeText).toHaveBeenCalledWith(REQUEST.url);
  });

  it("falls back to the clipboard on a browser with no share sheet", async () => {
    const result = await shareLesson(REQUEST, {
      writeText: vi.fn().mockResolvedValue(undefined),
    });
    expect(result).toEqual({ outcome: "shared", channel: "clipboard" });
  });

  it("counts nothing when neither path is available", async () => {
    const environment: ShareEnvironment = {};
    const result = await shareLesson(REQUEST, environment);
    expect(result).toEqual({ outcome: "failed", channel: "clipboard" });
    expect(isCounted(result)).toBe(false);
  });
});

describe("copyLink", () => {
  it("counts a clipboard write that resolves", async () => {
    const result = await copyLink(REQUEST.url, {
      writeText: vi.fn().mockResolvedValue(undefined),
    });
    expect(isCounted(result)).toBe(true);
  });

  it("does not count a refused clipboard write", async () => {
    // Permission denied, or an insecure context. The UI shows the URL to copy
    // by hand and records nothing.
    const result = await copyLink(REQUEST.url, {
      writeText: vi.fn().mockRejectedValue(new Error("NotAllowedError")),
    });
    expect(result).toEqual({ outcome: "failed", channel: "clipboard" });
    expect(isCounted(result)).toBe(false);
  });
});

describe("outbound links", () => {
  it("never count", () => {
    // `window.open` to an intent URL says the user left. It cannot say they
    // pressed Post: there is no callback and no way to observe another origin.
    const opened = {
      outcome: "opened",
      channel: "outbound_link",
      target: "x",
    } as const;
    expect(isCounted(opened)).toBe(false);
  });

  it("build an intent URL with the lesson escaped into it", () => {
    const url = outboundUrl("x", REQUEST.url, "A & B");
    expect(url).toContain(encodeURIComponent(REQUEST.url));
    expect(url).toContain(encodeURIComponent("A & B"));
    expect(url.startsWith("https://x.com/")).toBe(true);
  });

  it("reject a target that is not on the list", () => {
    // The target is stored. A free-form one would make the column a record of
    // whatever a caller passed.
    expect(isOutboundTarget("whatsapp")).toBe(true);
    expect(isOutboundTarget("javascript:alert(1)")).toBe(false);
    expect(isOutboundTarget("constructor")).toBe(false);
  });
});
