import { Node, mergeAttributes } from "@tiptap/react";

/** What `renderHTML` receives. Typed here rather than imported from
 * `@tiptap/core`, which is not a direct dependency — `@tiptap/react`
 * re-exports what this file needs, and depending on the re-export keeps the
 * dependency list honest about what the project installs. */
interface RenderContext {
  node: { attrs: Record<string, unknown> };
  HTMLAttributes: Record<string, unknown>;
}

/**
 * The block types StarterKit does not know about.
 *
 * Registering these is not a nicety. TipTap discards any node whose type it
 * cannot resolve when a document is loaded, so without them opening a lesson
 * that has a callout and pressing save would DELETE the callout — silently,
 * and only for the lessons that had one. `studying-chemistry` has two.
 *
 * Each node carries `blockId` as an attribute so the id survives editing; see
 * lib/lessons/tiptap-bridge.ts for why that matters.
 */

/** Every node here keeps its block id through an edit. */
const blockId = {
  blockId: {
    default: null as string | null,
    // Rendered into the DOM and parsed back out, so a copy-paste inside the
    // editor does not invent a new id — and so a round trip through the DOM,
    // which is what a paste is, does not lose the one it had.
    parseHTML: (element: HTMLElement) => element.getAttribute("data-block-id"),
    renderHTML: (attributes: Record<string, unknown>) =>
      attributes.blockId ? { "data-block-id": attributes.blockId } : {},
  },
};

export const Callout = Node.create({
  name: "callout",
  group: "block",
  // One paragraph of prose. Not `block+`: a callout holding a heading or
  // another callout is a shape the renderer does not have, and letting the
  // editor create one would mean content that cannot be displayed.
  content: "paragraph",
  defining: true,

  addAttributes() {
    return {
      ...blockId,
      variant: {
        default: "note",
        parseHTML: (element: HTMLElement) =>
          element.getAttribute("data-variant") ?? "note",
        renderHTML: (attributes: Record<string, unknown>) => ({
          "data-variant": attributes.variant,
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "aside[data-variant]" }];
  },

  renderHTML({ HTMLAttributes }: RenderContext) {
    return [
      "aside",
      mergeAttributes(HTMLAttributes, {
        class: "rounded-lg border-s-4 bg-secondary/50 p-4 text-sm",
      }),
      0,
    ];
  },
});

/**
 * An atom: the editor never edits the LaTeX inline, because a half-typed
 * formula rendered as you type is noise. The source is edited in a field and
 * the node is a placeholder for it.
 */
export const Equation = Node.create({
  name: "equation",
  group: "block",
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      ...blockId,
      latex: {
        default: "",
        parseHTML: (element: HTMLElement) => element.textContent ?? "",
        renderHTML: () => ({}),
      },
    };
  },

  parseHTML() {
    return [{ tag: "pre[data-equation]" }];
  },

  renderHTML({ node, HTMLAttributes }: RenderContext) {
    return [
      "pre",
      mergeAttributes(HTMLAttributes, {
        "data-equation": "",
        dir: "ltr",
        class: "rounded-lg border bg-muted p-4 text-center",
      }),
      String(node.attrs.latex ?? ""),
    ];
  },
});

/**
 * Image and video are atoms with no upload path yet — #27 owns the Cloudinary
 * pipeline. They exist here so that a lesson containing one can be OPENED and
 * saved without losing it, which is the whole reason these nodes are
 * registered at all.
 */
function mediaNode(name: "image" | "video", tag: string) {
  return Node.create({
    name,
    group: "block",
    atom: true,
    draggable: true,

    addAttributes() {
      return {
        ...blockId,
        src: { default: "" },
        alt: { default: "" },
        caption: { default: null },
        poster: { default: null },
        duration: { default: null },
      };
    },

    parseHTML() {
      return [{ tag }];
    },

    renderHTML({ HTMLAttributes }: RenderContext) {
      return [tag, mergeAttributes(HTMLAttributes, { class: "rounded-lg" })];
    },
  });
}

export const ImageBlock = mediaNode("image", "img");
export const VideoBlock = mediaNode("video", "video");

/** Adds `blockId` to the nodes StarterKit already provides, so their ids
 * survive too — a paragraph that loses its id loses its translation. */
export const BLOCK_ID_TYPES = [
  "paragraph",
  "heading",
  "bulletList",
  "orderedList",
  "blockquote",
  "codeBlock",
  "horizontalRule",
] as const;

export const BlockIds = Node.create({
  name: "blockIds",

  addGlobalAttributes() {
    return [{ types: [...BLOCK_ID_TYPES], attributes: blockId }];
  },
});
