"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Underline from "@tiptap/extension-underline";
import Placeholder from "@tiptap/extension-placeholder";
import CharacterCount from "@tiptap/extension-character-count";

import {
  BlockIds,
  Callout,
  Equation,
  ImageBlock,
  VideoBlock,
} from "@/components/lessons/editor/nodes";
import {
  fromBlocks,
  toBlocks,
  type ProseMirrorDoc,
} from "@/lib/lessons/tiptap-bridge";
import { isSafeHref, type LessonBlock } from "@/lib/lessons/blocks";
import { cn } from "@/lib/utils";

/**
 * One section's body, in TipTap.
 *
 * The editor's document is never what gets stored: `toBlocks` runs on every
 * change and the parent holds blocks, not ProseMirror JSON. So the thing being
 * autosaved and the thing being previewed are the same value the database will
 * hold, and a bridge bug shows up in the preview rather than after a save.
 */

/** Block ids for nodes the author has just created. Prefixed so a glance at a
 * row says where an id came from, and unique enough not to collide with the
 * seed's derived ids. */
function newBlockId(): string {
  return `b-${Math.random().toString(36).slice(2, 10)}`;
}

export function SectionEditor({
  blocks,
  onChange,
  placeholder,
  label,
}: {
  blocks: LessonBlock[];
  onChange: (blocks: LessonBlock[]) => void;
  placeholder: string;
  label: string;
}) {
  // The initial document only, computed once. Feeding the editor its own
  // output on every render would reset the cursor on every keystroke. Lazy
  // state rather than a ref, because a ref READ during render is the same
  // rule-breaking as one written during render.
  const [initialDoc] = useState<ProseMirrorDoc>(() => fromBlocks(blocks));

  // The editor is created once and its `onUpdate` closes over whatever
  // `onChange` was at that moment. This ref keeps that closure pointing at the
  // current callback — written in an effect, not during render, because a ref
  // mutated while rendering is a render with a side effect.
  const latest = useRef(onChange);
  useEffect(() => {
    latest.current = onChange;
  }, [onChange]);

  const editor = useEditor({
    // Next renders this on the server too; without it React warns about a
    // mismatch on every mount because ProseMirror decorates the DOM.
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        // The lesson title is the page's h1, so the body starts at 2. Offering
        // level 1 in the editor would let an author create a document with two
        // top-level headings and no way to see the problem.
        heading: { levels: [2, 3] },
      }),
      Underline,
      Link.configure({
        openOnClick: false,
        // The href is checked again on save and again at render. This is the
        // first of the three and the only one the author sees.
        validate: (href: string) => isSafeHref(href),
      }),
      Placeholder.configure({ placeholder }),
      CharacterCount,
      BlockIds,
      Callout,
      Equation,
      ImageBlock,
      VideoBlock,
    ],
    content: initialDoc,
    editorProps: {
      attributes: {
        "aria-label": label,
        class: "min-h-40 focus:outline-none",
      },
    },
    onUpdate({ editor: instance }) {
      latest.current(
        toBlocks(instance.getJSON() as ProseMirrorDoc, () => newBlockId()),
      );
    },
  });

  if (!editor) return null;

  return (
    <div className="rounded-lg border p-4">
      <EditorContent editor={editor} />
    </div>
  );
}

/**
 * Autosave, debounced, with the state of the last attempt.
 *
 * Debounced rather than saved per keystroke: a save per character is a write
 * per character. Two seconds is long enough to batch a sentence and short
 * enough that closing the tab rarely loses one.
 */
export type SaveState = "idle" | "dirty" | "saving" | "saved" | "failed";

export function useAutosave(
  save: () => Promise<boolean>,
  delayMs = 2000,
): [SaveState, () => void] {
  const [state, setState] = useState<SaveState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Same reason as above: the timer's callback is created once and must call
  // the CURRENT save, which closes over the current sections.
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  const markDirty = useCallback(() => {
    setState("dirty");
    if (timer.current) clearTimeout(timer.current);

    timer.current = setTimeout(() => {
      setState("saving");
      void saveRef.current().then((ok) => setState(ok ? "saved" : "failed"));
    }, delayMs);
  }, [delayMs]);

  // A pending save must not outlive the page: firing after unmount would write
  // a body the author has already navigated away from.
  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  return [state, markDirty];
}

export function SaveIndicator({
  state,
  labels,
}: {
  state: SaveState;
  labels: Record<SaveState, string>;
}) {
  return (
    <p
      // Polite, not assertive: a save status that interrupts a screen-reader
      // user mid-sentence is worse than one they hear a moment later.
      aria-live="polite"
      className={cn(
        "text-sm",
        state === "failed" ? "text-destructive" : "text-muted-foreground",
      )}
    >
      {labels[state]}
    </p>
  );
}
