import { describe, expect, it } from "vitest";

import {
  BODY_MAX,
  LINK_FLAG_THRESHOLD,
  LINK_REL,
  checkBody,
  safeHref,
  segments,
} from "@/lib/comments/body";

/**
 * A comment box is the first place this platform stores text a stranger wrote,
 * so what it does with that text is the security boundary.
 */

describe("what may be posted", () => {
  it("stores exactly what was typed, trimmed", () => {
    // Not HTML-escaped on the way in: escaping belongs at render, and escaping
    // here leaves the database holding `&amp;` where somebody typed `&`.
    const result = checkBody("  Sodium & chlorine  ");
    expect(result.ok).toBe(true);
    expect(result.body).toBe("Sodium & chlorine");
  });

  it("collapses a wall of blank lines", () => {
    expect(checkBody("one\n\n\n\n\ntwo").body).toBe("one\n\ntwo");
  });

  it("refuses whitespace pretending to be a comment", () => {
    expect(checkBody("   \n\n  ").reason).toBe("empty-after-trim");
    expect(checkBody("a").reason).toBe("too-short");
  });

  it("refuses a body past the cap", () => {
    expect(checkBody("a".repeat(BODY_MAX + 1)).reason).toBe("too-long");
    expect(checkBody("a".repeat(BODY_MAX)).ok).toBe(true);
  });

  it("flags a link-heavy comment rather than blocking it", () => {
    // A chemistry answer citing five papers is not spam, and refusing it
    // teaches people the box is broken.
    const links = Array.from(
      { length: LINK_FLAG_THRESHOLD + 1 },
      (_, i) => `https://example.com/paper-${i}`,
    ).join(" ");

    const result = checkBody(`See ${links}`);
    expect(result.ok).toBe(true);
    expect(result.flagged).toBe(true);
  });

  it("refuses a body that is nothing but links", () => {
    const links = Array.from(
      { length: LINK_FLAG_THRESHOLD * 4 + 1 },
      (_, i) => `https://spam.example/${i}`,
    ).join(" ");

    expect(checkBody(links).reason).toBe("too-many-links");
  });
});

describe("turning a body into something renderable", () => {
  it("splits text from links", () => {
    const parts = segments("Read https://example.com/x for more");
    expect(parts).toEqual([
      { kind: "text", text: "Read " },
      {
        kind: "link",
        text: "https://example.com/x",
        href: "https://example.com/x",
      },
      { kind: "text", text: " for more" },
    ]);
  });

  it("never returns a string of markup", () => {
    // The point of segments over an HTML string: there is nowhere for an
    // escaping mistake to live. The renderer puts text in text nodes.
    const parts = segments('<script>alert("x")</script> and <b>bold</b>');
    expect(parts.every((part) => part.kind === "text")).toBe(true);
    expect(parts.map((p) => p.text).join("")).toBe(
      '<script>alert("x")</script> and <b>bold</b>',
    );
  });

  it("leaves a javascript: URL as literal text, not a link", () => {
    // An allow-list of schemes, not a deny-list: a deny-list has to anticipate
    // every scheme a browser will ever honour, and one miss is a payload.
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("data:text/html,<script>x</script>")).toBeNull();
    expect(safeHref("vbscript:msgbox")).toBeNull();
    expect(safeHref("https://example.com/ok")).toBe("https://example.com/ok");
    expect(safeHref("mailto:someone@example.com")).toBe(
      "mailto:someone@example.com",
    );
  });

  it("does not drop a rejected link — the reader still sees what was written", () => {
    const parts = segments("try javascript:alert(1) now");
    expect(parts.some((part) => part.kind === "link")).toBe(false);
    expect(parts.map((p) => p.text).join("")).toContain("javascript:alert(1)");
  });

  it("links a bare www host, which a reader expects to work", () => {
    const parts = segments("see www.example.com");
    const link = parts.find((part) => part.kind === "link");
    expect(link).toBeDefined();
    expect(link?.kind === "link" && link.href.startsWith("http")).toBe(true);
  });

  it("reassembles to exactly the original body", () => {
    // Nothing may be lost or duplicated in the split, however odd the input:
    // a renderer that drops a character is a renderer that changes what
    // somebody said.
    for (const body of [
      "plain",
      "https://a.example/one https://b.example/two",
      "trailing https://a.example/x",
      "(parenthesised https://a.example/y)",
      "email me at a@b.example please",
      "https://example.com/only",
    ]) {
      expect(
        segments(body)
          .map((part) => part.text)
          .join(""),
        body,
      ).toBe(body);
    }
  });

  it("carries the rel that stops the comment box being an SEO product", () => {
    // `nofollow ugc` is the entire economics of comment spam; `noopener` stops
    // a new tab reaching back through `window.opener`.
    expect(LINK_REL).toContain("nofollow");
    expect(LINK_REL).toContain("ugc");
    expect(LINK_REL).toContain("noopener");
    expect(LINK_REL).toContain("noreferrer");
  });
});
