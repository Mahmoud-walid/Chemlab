import { z } from "zod";

/**
 * What a lesson is made of.
 *
 * A closed, discriminated union stored as `jsonb`, not an HTML string and not
 * a free-form editor document. #20 argues the case; the three properties that
 * decide it:
 *
 * - **Translation.** A translated section maps block id → translated text, so
 *   images, video and layout stay shared between locales. An HTML blob has to
 *   be duplicated per locale, and any structural edit to the English silently
 *   desynchronises the Arabic with no way to tell which paragraph moved.
 * - **Sanitisation.** An HTML blob needs an allow-list sanitiser at every
 *   render, for ever, and every sanitiser CVE becomes ours. A closed union has
 *   no arbitrary attributes: an unknown `type` renders nothing, and the whole
 *   attack surface is the handful of URL fields validated below.
 * - **Structure is read by more than the page.** Reading time, the table of
 *   contents, a plain-text search index and eventually a PDF export all read
 *   the shape. Recovering that from HTML is regex work.
 *
 * The cost, accepted: every new block type is code in three places — this
 * schema, the editor node, and the renderer.
 *
 * Pure. No database, no `server-only`: the same schema validates on write in a
 * server action and narrows on read in a server component.
 */

/* ------------------------------------------------------------- rich text -- */

/**
 * Inline marks, as a closed list.
 *
 * A `link` is a mark rather than a block because it lives inside a sentence.
 * Its href is validated here and again at render — rows written before a
 * schema change exist, and validating only on write protects only the rows
 * written after it.
 */
export const MARKS = ["bold", "italic", "underline", "code"] as const;

/**
 * `javascript:` and `data:` parse perfectly well as URLs and would go straight
 * into an `href`. Only these two schemes are ever rendered.
 */
export function isSafeHref(value: string): boolean {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

export const richTextSchema = z.object({
  text: z.string(),
  marks: z.array(z.enum(MARKS)).optional(),
  href: z.string().refine(isSafeHref, "Links must be http(s).").optional(),
});

export type RichText = z.infer<typeof richTextSchema>;

const inline = z.array(richTextSchema);

/* ----------------------------------------------------------- media hosts -- */

/**
 * Where an image or a video may be served from.
 *
 * A pasted URL is what the editor supports today — #27 replaces it with a
 * `mediaId` pointing at a signed Cloudinary upload, and this list is what
 * keeps the gap from being "any host on the internet inside an `<img src>`".
 * Configured rather than hard-coded so a deployment can name its own delivery
 * host without a code change; empty means "no external media accepted", which
 * is the correct default for a site that has not configured one.
 */
export function allowedMediaHosts(
  env: Record<string, string | undefined> = process.env,
): string[] {
  return (env.NEXT_PUBLIC_MEDIA_HOSTS ?? "res.cloudinary.com")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
}

export function isAllowedMediaUrl(
  value: string,
  hosts: string[] = allowedMediaHosts(),
): boolean {
  try {
    const url = new URL(value);
    // https only. An http image on an https page is a mixed-content block in
    // every browser, so accepting one would store a URL that cannot render.
    if (url.protocol !== "https:") return false;
    return hosts.includes(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

const mediaUrl = z
  .string()
  .refine(
    (value) => isAllowedMediaUrl(value),
    "Media must be served from a configured delivery host.",
  );

/* --------------------------------------------------------------- blocks --- */

/** Stable across edits and locales: a translation addresses this id. */
const blockId = z.string().min(1).max(64);

export const HEADING_LEVELS = [2, 3] as const;

/**
 * Level 2 and 3 only. The page's `<h1>` is the lesson title, so a level-1
 * heading inside the body would give the document two top-level headings and
 * break the outline a screen reader announces.
 */
const headingBlock = z.object({
  id: blockId,
  type: z.literal("heading"),
  level: z.union([z.literal(2), z.literal(3)]),
  text: z.string().min(1),
  /** The `#fragment` the table of contents links to. */
  anchor: z.string().min(1),
});

const paragraphBlock = z.object({
  id: blockId,
  type: z.literal("paragraph"),
  text: inline,
});

const imageBlock = z.object({
  id: blockId,
  type: z.literal("image"),
  url: mediaUrl,
  /**
   * Required, and allowed to be empty — but only deliberately. An absent `alt`
   * is an oversight; `alt: ""` is an author saying the image is decorative.
   * The two are different claims and a screen reader treats them differently.
   */
  alt: z.string(),
  caption: z.string().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
});

const videoBlock = z.object({
  id: blockId,
  type: z.literal("video"),
  url: mediaUrl,
  caption: z.string().optional(),
  posterUrl: mediaUrl.optional(),
  /** Seconds. Counted into reading time, unlike an image's flat estimate. */
  durationSeconds: z.number().int().nonnegative().optional(),
});

const codeBlock = z.object({
  id: blockId,
  type: z.literal("code"),
  language: z.string().max(32),
  code: z.string(),
});

export const CALLOUT_VARIANTS = ["note", "warning", "safety"] as const;

const calloutBlock = z.object({
  id: blockId,
  type: z.literal("callout"),
  variant: z.enum(CALLOUT_VARIANTS),
  text: inline,
});

const quoteBlock = z.object({
  id: blockId,
  type: z.literal("quote"),
  text: inline,
  attribution: z.string().optional(),
});

const listBlock = z.object({
  id: blockId,
  type: z.literal("list"),
  ordered: z.boolean(),
  items: z.array(inline),
});

const equationBlock = z.object({
  id: blockId,
  type: z.literal("equation"),
  /**
   * Rendered as pre-formatted text for now, not typeset. Chemistry notation
   * has its own conventions (see docs/chemical-equations.md) and #20 leaves
   * the choice between KaTeX and a chemistry-specific block open; storing the
   * source now means the decision changes the renderer, not the data.
   */
  latex: z.string(),
});

const dividerBlock = z.object({
  id: blockId,
  type: z.literal("divider"),
});

export const blockSchema = z.discriminatedUnion("type", [
  paragraphBlock,
  headingBlock,
  imageBlock,
  videoBlock,
  codeBlock,
  calloutBlock,
  quoteBlock,
  listBlock,
  equationBlock,
  dividerBlock,
]);

export type LessonBlock = z.infer<typeof blockSchema>;
export type BlockType = LessonBlock["type"];

/** The whole body. Strict: one bad block fails the write. */
export const blocksSchema = z.array(blockSchema);

/**
 * The READ path, which cannot be strict.
 *
 * A row written before a schema change is already in the table, and refusing
 * to render a lesson because one block gained a field is a blank page where
 * there was an article. Unknown and invalid blocks are dropped — silently for
 * the reader, loudly in the log for whoever has to fix the row.
 */
export function parseBlocks(value: unknown): LessonBlock[] {
  if (!Array.isArray(value)) return [];

  const kept: LessonBlock[] = [];
  for (const candidate of value) {
    const result = blockSchema.safeParse(candidate);
    if (result.success) {
      kept.push(result.data);
    } else if (process.env.NODE_ENV !== "production") {
      console.warn("Dropped an unrenderable lesson block", result.error.issues);
    }
  }
  return kept;
}

/* ------------------------------------------------------------- derived ---- */

export interface TocEntry {
  id: string;
  level: 2 | 3;
  text: string;
  anchor: string;
}

/** The table of contents, derived rather than stored: two sources for one
 * outline is one outline that goes stale. */
export function tableOfContents(blocks: readonly LessonBlock[]): TocEntry[] {
  return blocks
    .filter((block) => block.type === "heading")
    .map((block) => ({
      id: block.id,
      level: block.level,
      text: block.text,
      anchor: block.anchor,
    }));
}

/** Plain text, for reading time, search indexing and the excerpt. */
export function blocksToText(blocks: readonly LessonBlock[]): string {
  return blocks
    .map((block) => {
      switch (block.type) {
        case "paragraph":
        case "callout":
        case "quote":
          return inlineText(block.text);
        case "heading":
          return block.text;
        case "list":
          return block.items.map(inlineText).join("\n");
        case "code":
          return block.code;
        case "equation":
          return block.latex;
        case "image":
          // The caption is prose a reader reads; the alt text is a description
          // of the image, and counting it would inflate the reading time for
          // sighted and unsighted readers alike.
          return block.caption ?? "";
        case "video":
          return block.caption ?? "";
        case "divider":
          return "";
      }
    })
    .filter(Boolean)
    .join("\n\n");
}

function inlineText(runs: readonly RichText[]): string {
  return runs.map((run) => run.text).join("");
}

/** A slug for a heading's anchor. Deterministic, so re-saving a lesson does
 * not invalidate every link anybody has shared into it. */
export function anchorFor(text: string, fallback: string): string {
  const slug = text
    .toLowerCase()
    .replaceAll(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replaceAll(/^-+|-+$/g, "");
  return slug || fallback;
}
