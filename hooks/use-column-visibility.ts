"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

import {
  parseHidden,
  readRaw,
  serialiseHidden,
  toggleHidden,
  visibilityKey,
  writeRaw,
  type ColumnSpec,
} from "@/lib/admin/column-visibility";

/**
 * The columns this viewer has hidden, read from `localStorage`.
 *
 * `useSyncExternalStore` rather than an effect that reads storage and calls
 * `setState`. Three reasons, in order of how much they matter:
 *
 * 1. It is what the primitive is for. localStorage IS an external store, and
 *    the effect-plus-setState version is the pattern React added this hook to
 *    replace — the compiler flags it as a cascading render, correctly.
 * 2. `getServerSnapshot` makes the server/client difference explicit. The
 *    server cannot know what a browser stored, so it renders every column;
 *    that is the right thing to show anyway, and hydration is told to expect
 *    it rather than throwing the table away.
 * 3. The `storage` event comes free, so hiding a column in one tab updates
 *    the same table open in another. Small, but the alternative is two tabs
 *    quietly disagreeing.
 *
 * The snapshot is the RAW string. Returning a parsed `Set` would return a new
 * object every call, and `useSyncExternalStore` compares snapshots by
 * identity — a fresh object each time is an infinite render loop.
 */

/** Local writes do not raise a `storage` event; this tells our own tab. */
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  // Cross-tab. Fires only for OTHER documents, which is exactly the half the
  // local set does not cover.
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

export interface ColumnVisibility {
  hidden: Set<string>;
  toggle: (column: ColumnSpec) => void;
}

export function useColumnVisibility(
  tableId: string | undefined,
  columns: ColumnSpec[],
): ColumnVisibility {
  const key = tableId ? visibilityKey(tableId) : "";

  const raw = useSyncExternalStore(
    subscribe,
    // Client: whatever is stored, as a string that is stable while unchanged.
    useCallback(() => (key ? readRaw(key) : ""), [key]),
    // Server: nothing is hidden. Every column, which is also the right
    // fallback for a browser that cannot store anything.
    () => "",
  );

  const hidden = useMemo(() => parseHidden(raw, columns), [raw, columns]);

  const toggle = useCallback(
    (column: ColumnSpec) => {
      if (!key) return;
      // Re-read rather than closing over the current value: another tab may
      // have changed it since this render, and a toggle that overwrites what
      // it did not see is how two tabs end up disagreeing permanently.
      const next = toggleHidden(parseHidden(readRaw(key), columns), column);
      writeRaw(key, serialiseHidden(next));
      notify();
    },
    [key, columns],
  );

  return { hidden, toggle };
}
