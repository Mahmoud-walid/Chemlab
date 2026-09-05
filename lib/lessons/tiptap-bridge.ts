import { anchorFor, type LessonBlock, type RichText } from "./blocks";

/**
 * Between the editor's document and our blocks.
 *
 * TipTap speaks ProseMirror: a tree of nodes with marks. We store a flat,
 * closed union of blocks. #20 chose to own this translation rather than store
 * the editor's document directly, and the reason is worth restating here,
 * where the cost is paid: storing ProseMirror JSON would make the SCHEMA of
 * every lesson whatever version of TipTap last saved it. An editor upgrade
 * that changes a node's shape would silently change what is in the column, and
 * the renderer would have to keep up with an editor it does not use.
 *
 * The translation is lossy in one direction ON PURPOSE. ProseMirror can
 * express things our blocks cannot — nested lists, tables, arbitrary
 * attributes — and those are dropped rather than smuggled through as
 * something else. A block model that quietly grows a shape the renderer does
 * not handle is a block model that renders blank paragraphs.
 *
 * Pure: no editor instance, no DOM. `toBlocks(fromBlocks(x))` is a property
 * test, not a manual check.
 */

/** The subset of a ProseMirror document this bridge reads and writes. */
export interface ProseMirrorNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: ProseMirrorNode[];
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  text?: string;
}

export interface ProseMirrorDoc {
  type: "doc";
  content: ProseMirrorNode[];
}

/* ------------------------------------------------------------ to blocks -- */

/**
 * `id` is supplied by the caller for nodes that have none.
 *
 * The editor round-trips ids through node attributes, so an existing block
 * keeps its id across an edit — which is what keeps its translation attached.
 * A NEW node has no id yet, and generating one here would make this function
 * impure and its round-trip untestable, so the caller passes a generator.
 */
export function toBlocks(
  doc: ProseMirrorDoc,
  nextId: (index: number) => string,
): LessonBlock[] {
  const blocks: LessonBlock[] = [];

  for (const [index, node] of (doc.content ?? []).entries()) {
    const id = (node.attrs?.blockId as string | undefined) ?? nextId(index);
    const block = nodeToBlock(node, id);
    // An unconvertible node is dropped, loudly in development. The
    // alternative — a best-effort paragraph holding its text — turns a table
    // somebody pasted into a wall of run-on prose that looks intentional.
    if (block) {
      blocks.push(block);
    } else if (process.env.NODE_ENV !== "production") {
      console.warn(`Dropped an unconvertible editor node: ${node.type}`);
    }
  }

  return blocks;
}

function nodeToBlock(node: ProseMirrorNode, id: string): LessonBlock | null {
  switch (node.type) {
    case "paragraph":
      return { id, type: "paragraph", text: inlineFrom(node.content) };

    case "heading": {
      const level = Number(node.attrs?.level);
      // Anything outside 2–3 is clamped rather than dropped: the author meant
      // a heading, and losing it would lose a table-of-contents entry. Level 1
      // becomes 2 because the page's h1 is the lesson title.
      const clamped = level >= 3 ? 3 : 2;
      const text = plainFrom(node.content);
      return {
        id,
        type: "heading",
        level: clamped as 2 | 3,
        text,
        anchor:
          (node.attrs?.anchor as string | undefined) ?? anchorFor(text, id),
      };
    }

    case "bulletList":
    case "orderedList":
      return {
        id,
        type: "list",
        ordered: node.type === "orderedList",
        // A list item holds paragraphs; only the first is kept, because the
        // block model has no nesting and a second paragraph inside an item
        // would have nowhere to go that a reader would understand.
        items: (node.content ?? []).map((item) =>
          inlineFrom(item.content?.[0]?.content),
        ),
      };

    case "blockquote":
      return {
        id,
        type: "quote",
        text: inlineFrom(node.content?.[0]?.content),
        attribution: node.attrs?.attribution as string | undefined,
      };

    case "codeBlock":
      return {
        id,
        type: "code",
        language: (node.attrs?.language as string | undefined) ?? "text",
        code: plainFrom(node.content),
      };

    case "horizontalRule":
      return { id, type: "divider" };

    case "callout":
      return {
        id,
        type: "callout",
        variant: calloutVariant(node.attrs?.variant),
        text: inlineFrom(node.content?.[0]?.content ?? node.content),
      };

    case "image":
      return {
        id,
        type: "image",
        url: String(node.attrs?.src ?? ""),
        alt: String(node.attrs?.alt ?? ""),
        caption: optionalString(node.attrs?.caption),
      };

    case "video":
      return {
        id,
        type: "video",
        url: String(node.attrs?.src ?? ""),
        caption: optionalString(node.attrs?.caption),
        posterUrl: optionalString(node.attrs?.poster),
        durationSeconds: optionalNumber(node.attrs?.duration),
      };

    case "equation":
      return { id, type: "equation", latex: String(node.attrs?.latex ?? "") };

    default:
      return null;
  }
}

/* ---------------------------------------------------------- from blocks -- */

export function fromBlocks(blocks: readonly LessonBlock[]): ProseMirrorDoc {
  return {
    type: "doc",
    // `blockId` travels as an attribute so the id survives a round trip —
    // without it every save would re-key every block and orphan every
    // translation attached to one.
    content: blocks.map(blockToNode),
  };
}

function blockToNode(block: LessonBlock): ProseMirrorNode {
  const attrs = { blockId: block.id };

  switch (block.type) {
    case "paragraph":
      return { type: "paragraph", attrs, content: inlineTo(block.text) };

    case "heading":
      return {
        type: "heading",
        attrs: { ...attrs, level: block.level, anchor: block.anchor },
        content: block.text ? [{ type: "text", text: block.text }] : [],
      };

    case "list":
      return {
        type: block.ordered ? "orderedList" : "bulletList",
        attrs,
        content: block.items.map((item) => ({
          type: "listItem",
          content: [{ type: "paragraph", content: inlineTo(item) }],
        })),
      };

    case "quote":
      return {
        type: "blockquote",
        attrs: block.attribution
          ? { ...attrs, attribution: block.attribution }
          : attrs,
        content: [{ type: "paragraph", content: inlineTo(block.text) }],
      };

    case "code":
      return {
        type: "codeBlock",
        attrs: { ...attrs, language: block.language },
        content: block.code ? [{ type: "text", text: block.code }] : [],
      };

    case "divider":
      return { type: "horizontalRule", attrs };

    case "callout":
      return {
        type: "callout",
        attrs: { ...attrs, variant: block.variant },
        content: [{ type: "paragraph", content: inlineTo(block.text) }],
      };

    case "image":
      return {
        type: "image",
        attrs: {
          ...attrs,
          src: block.url,
          alt: block.alt,
          ...(block.caption === undefined ? {} : { caption: block.caption }),
        },
      };

    case "video":
      return {
        type: "video",
        attrs: {
          ...attrs,
          src: block.url,
          ...(block.caption === undefined ? {} : { caption: block.caption }),
          ...(block.posterUrl === undefined ? {} : { poster: block.posterUrl }),
          ...(block.durationSeconds === undefined
            ? {}
            : { duration: block.durationSeconds }),
        },
      };

    case "equation":
      return { type: "equation", attrs: { ...attrs, latex: block.latex } };
  }
}

/* ---------------------------------------------------------------- inline -- */

/** Marks we round-trip. Anything else on a text node is dropped with it. */
const MARK_NAMES: Record<
  string,
  RichText["marks"] extends (infer M)[] | undefined ? M : never
> = {
  bold: "bold",
  italic: "italic",
  underline: "underline",
  code: "code",
} as const;

function inlineFrom(nodes: ProseMirrorNode[] | undefined): RichText[] {
  const runs: RichText[] = [];

  for (const node of nodes ?? []) {
    if (node.type !== "text" || !node.text) continue;

    const marks: RichText["marks"] = [];
    let href: string | undefined;

    for (const mark of node.marks ?? []) {
      if (mark.type === "link") {
        href = typeof mark.attrs?.href === "string" ? mark.attrs.href : href;
        continue;
      }
      const known = MARK_NAMES[mark.type];
      if (known) marks.push(known);
    }

    runs.push({
      text: node.text,
      // Omitted rather than empty, so a round trip is value-equal: `marks: []`
      // and no marks at all mean the same thing and must not compare
      // different, or every round-trip test becomes a false alarm.
      ...(marks.length > 0 ? { marks } : {}),
      ...(href ? { href } : {}),
    });
  }

  return runs;
}

function inlineTo(runs: readonly RichText[]): ProseMirrorNode[] {
  return runs.map((run) => {
    const marks = (run.marks ?? []).map((mark) => ({ type: mark }));
    if (run.href)
      marks.push({ type: "link", attrs: { href: run.href } } as never);

    return {
      type: "text",
      text: run.text,
      ...(marks.length > 0 ? { marks } : {}),
    };
  });
}

function plainFrom(nodes: ProseMirrorNode[] | undefined): string {
  return (nodes ?? []).map((node) => node.text ?? "").join("");
}

function calloutVariant(value: unknown): "note" | "warning" | "safety" {
  return value === "warning" || value === "safety" ? value : "note";
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}
