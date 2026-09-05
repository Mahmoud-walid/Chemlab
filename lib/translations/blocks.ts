import type { LessonBlock, RichText } from "@/lib/lessons/blocks";

/**
 * Translating a lesson body, one text field at a time.
 *
 * The rule that shapes all of this: **a translation has the same blocks, in
 * the same order, with the same ids as its source.** It is not a second
 * document that happens to be in Arabic — it is the same document with the
 * words replaced.
 *
 * That is not tidiness. `lib/lessons/blocks.ts` already says why: a
 * translation that can gain, lose or reorder a block "desynchronises the
 * Arabic with no way to tell which paragraph moved" — and the section anchors
 * a table of contents links to are derived from position, so a shared link
 * would resolve to different text in each language. Building the translation
 * FROM the source rather than editing it freely makes that impossible instead
 * of merely discouraged.
 *
 * So the editor is not a second block editor. It is a list of the source's
 * text fields with a box beside each one, and `applyTranslations` puts them
 * back into the source's own structure.
 */

/** One thing a translator is asked to write. */
export interface TranslatableField {
  /** `blockId:path`, stable across edits as long as the block survives. */
  key: string;
  /** The block it belongs to, for grouping in the UI. */
  blockId: string;
  blockType: LessonBlock["type"];
  /** What this field is, for a label: `text`, `alt`, `caption`, `item`. */
  kind: "text" | "alt" | "caption" | "attribution" | "item";
  /** The source words. */
  source: string;
  /**
   * True for a field that is allowed to be empty in the source — an image's
   * `alt` on a decorative image, say. An empty source needs no translation,
   * and asking for one produces an empty box nobody knows what to do with.
   */
  optional: boolean;
}

const key = (blockId: string, path: string) => `${blockId}:${path}`;

/**
 * Inline text is collected span by span rather than flattened.
 *
 * A span carries its own marks and its `href`. Flattening the array to one
 * string for the translator and rebuilding it as one unmarked span would
 * silently drop every bold, every link — in chemistry content, links to
 * definitions. One field per span keeps them by construction: the translated
 * span replaces only the words.
 */
function inlineFields(
  blockId: string,
  blockType: LessonBlock["type"],
  path: string,
  spans: RichText[],
  kind: TranslatableField["kind"] = "text",
): TranslatableField[] {
  return spans.map((span, index) => ({
    key: key(blockId, `${path}.${index}`),
    blockId,
    blockType,
    kind,
    source: span.text,
    optional: false,
  }));
}

/** Every field of one block a translator should be given. */
function fieldsOf(block: LessonBlock): TranslatableField[] {
  const base = { blockId: block.id, blockType: block.type };

  switch (block.type) {
    case "paragraph":
    case "callout":
      return inlineFields(block.id, block.type, "text", block.text);

    case "quote":
      return [
        ...inlineFields(block.id, block.type, "text", block.text),
        ...(block.attribution
          ? [
              {
                ...base,
                key: key(block.id, "attribution"),
                kind: "attribution" as const,
                source: block.attribution,
                optional: true,
              },
            ]
          : []),
      ];

    case "heading":
      // `anchor` is NOT here, and that is the point: it is the fragment a
      // shared link carries, and translating it would break every link into
      // the section from the other language.
      return [
        {
          ...base,
          key: key(block.id, "text"),
          kind: "text",
          source: block.text,
          optional: false,
        },
      ];

    case "list":
      return block.items.flatMap((item, index) =>
        inlineFields(block.id, block.type, `items.${index}`, item, "item"),
      );

    case "image":
      return [
        {
          ...base,
          key: key(block.id, "alt"),
          kind: "alt",
          // An empty `alt` is an author saying the image is decorative — a
          // deliberate claim, not an oversight — so it is not something to
          // ask a translator to fill in.
          source: block.alt,
          optional: true,
        },
        ...(block.caption
          ? [
              {
                ...base,
                key: key(block.id, "caption"),
                kind: "caption" as const,
                source: block.caption,
                optional: true,
              },
            ]
          : []),
      ];

    case "video":
      return block.caption
        ? [
            {
              ...base,
              key: key(block.id, "caption"),
              kind: "caption",
              source: block.caption,
              optional: true,
            },
          ]
        : [];

    // Nothing to translate. Code is code; an equation's LaTeX is notation, not
    // prose — and `docs/chemical-equations.md` is explicit that the notation
    // is the same in both languages. A divider has no words at all.
    case "code":
    case "equation":
    case "divider":
      return [];
  }
}

/** Every field across a body, in reading order. */
export function translatableFields(blocks: LessonBlock[]): TranslatableField[] {
  return blocks.flatMap(fieldsOf);
}

/** How much of a body has been written. For a progress line, not a gate. */
export function translatedCount(
  blocks: LessonBlock[],
  values: Record<string, string>,
): { done: number; total: number } {
  const fields = translatableFields(blocks).filter((field) => !field.optional);
  return {
    done: fields.filter((field) => (values[field.key] ?? "").trim() !== "")
      .length,
    total: fields.length,
  };
}

function translatedSpans(
  blockId: string,
  path: string,
  spans: RichText[],
  values: Record<string, string>,
): RichText[] {
  return spans.map((span, index) => {
    // Presence is decided on the trimmed value; the value STORED is the raw
    // one. Inline spans carry meaningful edge whitespace — "An acid is a "
    // needs its trailing space before the bold run that follows — and
    // trimming a translator's input would run two words together.
    const raw = values[key(blockId, `${path}.${index}`)];
    const written = raw?.trim() ? raw : undefined;
    // The span's marks and href survive; only its words change. An untranslated
    // span keeps the source text rather than becoming empty — a half-written
    // draft should still be a readable document, and `status` is what keeps
    // drafts away from readers.
    return written ? { ...span, text: written } : span;
  });
}

/**
 * The source body with the translated words in it.
 *
 * Every id, type, level, anchor, URL and dimension comes from the source.
 * There is no path by which a translation can differ structurally, which is
 * why nothing downstream has to check that it does not.
 */
export function applyTranslations(
  blocks: LessonBlock[],
  values: Record<string, string>,
): LessonBlock[] {
  const pick = (blockId: string, path: string, fallback: string) => {
    // Same rule as the spans: blank means untranslated, anything else is kept
    // exactly as written.
    const raw = values[key(blockId, path)];
    return raw?.trim() ? raw : fallback;
  };

  return blocks.map((block): LessonBlock => {
    switch (block.type) {
      case "paragraph":
      case "callout":
        return {
          ...block,
          text: translatedSpans(block.id, "text", block.text, values),
        };

      case "quote":
        return {
          ...block,
          text: translatedSpans(block.id, "text", block.text, values),
          ...(block.attribution
            ? {
                attribution: pick(block.id, "attribution", block.attribution),
              }
            : {}),
        };

      case "heading":
        return { ...block, text: pick(block.id, "text", block.text) };

      case "list":
        return {
          ...block,
          items: block.items.map((item, index) =>
            translatedSpans(block.id, `items.${index}`, item, values),
          ),
        };

      case "image":
        return {
          ...block,
          alt: pick(block.id, "alt", block.alt),
          ...(block.caption
            ? { caption: pick(block.id, "caption", block.caption) }
            : {}),
        };

      case "video":
        return block.caption
          ? { ...block, caption: pick(block.id, "caption", block.caption) }
          : block;

      case "code":
      case "equation":
      case "divider":
        return block;
    }
  });
}

/**
 * The values an existing translation already holds, keyed the same way.
 *
 * Reads the translation's own blocks against the SOURCE's field list, so a
 * source that has since gained a paragraph shows an empty box for it rather
 * than silently dropping the paragraph from the form.
 */
export function valuesFromBlocks(
  source: LessonBlock[],
  translated: LessonBlock[] | null | undefined,
): Record<string, string> {
  if (!translated) return {};

  const byId = new Map(translated.map((block) => [block.id, block]));
  const values: Record<string, string> = {};

  for (const field of translatableFields(source)) {
    const block = byId.get(field.blockId);
    if (!block || block.type !== field.blockType) continue;

    const [, path] = field.key.split(/:(.+)/);
    const text = textAt(block, path ?? "");
    // Only a value that actually differs from the source is a translation. A
    // field left untouched carries the source words forward (see
    // `translatedSpans`), and showing those back as if somebody wrote them
    // would make an untranslated body look finished.
    if (text !== undefined && text !== field.source) values[field.key] = text;
  }

  return values;
}

/** The string a field key points at, inside one block. */
function textAt(block: LessonBlock, path: string): string | undefined {
  if (path === "alt" && block.type === "image") return block.alt;
  if (path === "caption") {
    return block.type === "image" || block.type === "video"
      ? block.caption
      : undefined;
  }
  if (path === "attribution" && block.type === "quote") {
    return block.attribution;
  }
  if (path === "text" && block.type === "heading") return block.text;

  const spanMatch = /^text\.(\d+)$/.exec(path);
  if (spanMatch) {
    if (
      block.type !== "paragraph" &&
      block.type !== "callout" &&
      block.type !== "quote"
    ) {
      return undefined;
    }
    return block.text[Number(spanMatch[1])]?.text;
  }

  const itemMatch = /^items\.(\d+)\.(\d+)$/.exec(path);
  if (itemMatch && block.type === "list") {
    return block.items[Number(itemMatch[1])]?.[Number(itemMatch[2])]?.text;
  }

  return undefined;
}
