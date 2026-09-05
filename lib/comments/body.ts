// The named export: v6 ships ESM whose default is the module namespace, so
// `import LinkifyIt from "linkify-it"` gives an object that is not
// constructable — and the failure is a TypeScript error rather than a runtime
// surprise only because the types are accurate.
import { LinkifyIt } from "linkify-it";

/**
 * What a comment body may contain, and how it is turned into something safe to
 * render.
 *
 * **Plain text, linkified at render.** No HTML, no markdown, no editor. A
 * comment box that accepts markup is a comment box that has to sanitise it,
 * and the sanitiser is where the bugs live. Storing exactly what was typed
 * means the renderer has one job and `<script>` is four characters somebody
 * typed rather than an attack.
 *
 * Pure: no database, no request, no React. The linkifier runs here so the same
 * decisions can be tested directly.
 */

const linkify = new LinkifyIt();
// Bare `www.` without a scheme is still a link a reader expects to work.
linkify.set({ fuzzyLink: true, fuzzyEmail: false, fuzzyIP: false });

export const BODY_MIN = 2;
export const BODY_MAX = 2_000;

/**
 * Only these become links.
 *
 * An allow-list rather than a deny-list of `javascript:` and friends: a
 * deny-list has to anticipate every scheme a browser will ever honour, and it
 * only takes one — `data:`, `vbscript:`, a scheme invented next year — to turn
 * a comment into a payload. Anything else stays literal text, which is exactly
 * what the person typed.
 */
const ALLOWED_SCHEMES = new Set(["http:", "https:", "mailto:"]);

export type BodyRejection =
  "too-short" | "too-long" | "empty-after-trim" | "too-many-links";

/** Links past this are flagged for a moderator, not blocked. A chemistry
 * answer citing five papers is not spam, and refusing it teaches people the
 * box is broken. */
export const LINK_FLAG_THRESHOLD = 4;

export interface BodyCheck {
  ok: boolean;
  reason?: BodyRejection;
  /** The body as it will be stored: trimmed, with runs of blank lines
   * collapsed. Never HTML-escaped here — escaping belongs at render, and
   * escaping on the way in means the database holds `&amp;` where somebody
   * typed `&`. */
  body?: string;
  /** True when it should be posted but seen by a moderator. */
  flagged?: boolean;
}

export function checkBody(raw: string): BodyCheck {
  // Trim first: a body of spaces is empty, whatever its length says.
  const body = raw
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (body.length === 0) return { ok: false, reason: "empty-after-trim" };
  if (body.length < BODY_MIN) return { ok: false, reason: "too-short" };
  if (body.length > BODY_MAX) return { ok: false, reason: "too-long" };

  const links = linkify.match(body) ?? [];
  // A wall of links is the shape spam takes. Refused outright rather than
  // flagged only past the point where no honest comment reaches.
  if (links.length > LINK_FLAG_THRESHOLD * 4) {
    return { ok: false, reason: "too-many-links" };
  }

  return { ok: true, body, flagged: links.length > LINK_FLAG_THRESHOLD };
}

/** A run of body text, or a link within it. */
export type Segment =
  { kind: "text"; text: string } | { kind: "link"; text: string; href: string };

/**
 * Splits a body into text and links, for a renderer that outputs elements
 * rather than HTML.
 *
 * Returning SEGMENTS rather than an HTML string is the point: there is no
 * string of markup anywhere for an escaping mistake to live in. The renderer
 * puts text in text nodes and links in `<a>` elements, and React escapes both.
 */
export function segments(body: string): Segment[] {
  const matches = linkify.match(body) ?? [];
  if (matches.length === 0) return [{ kind: "text", text: body }];

  const out: Segment[] = [];
  let index = 0;

  for (const match of matches) {
    if (match.index > index) {
      out.push({ kind: "text", text: body.slice(index, match.index) });
    }

    const href = safeHref(match.url);
    // A scheme we do not allow is not a link, and not dropped either: the
    // reader still sees what was written.
    out.push(
      href
        ? { kind: "link", text: match.text, href }
        : { kind: "text", text: match.text },
    );

    index = match.lastIndex;
  }

  if (index < body.length) {
    out.push({ kind: "text", text: body.slice(index) });
  }

  return out;
}

/** The URL to link to, or null when its scheme is not allowed. */
export function safeHref(url: string): string | null {
  try {
    const parsed = new URL(url);
    return ALLOWED_SCHEMES.has(parsed.protocol) ? parsed.href : null;
  } catch {
    return null;
  }
}

/**
 * What every rendered link carries.
 *
 * `nofollow ugc` because a comment box is otherwise a way to buy PageRank from
 * this site, which is the entire economics of comment spam. `noopener` because
 * a link opened in a new tab can otherwise reach back through `window.opener`.
 */
export const LINK_REL = "nofollow ugc noopener noreferrer";
