"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

import {
  parseSelection,
  serialiseSelection,
  setPageSelected,
  toggleSelected,
} from "@/lib/admin/selection";

/**
 * The rows ticked in one view, held in `sessionStorage`.
 *
 * `sessionStorage`, not `localStorage`: a pending selection is not a
 * preference. It should not survive closing the tab, and two tabs open on the
 * same list should not share one — an operator ticking rows in one window and
 * finding them ticked in another has no way to tell which window they meant.
 *
 * Read through `useSyncExternalStore` for the same reasons the column
 * preference is (see `use-column-visibility.ts`): storage is an external
 * store, the server has no idea what a tab holds, and the snapshot must be a
 * stable string rather than a fresh array.
 */

const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  // Cross-tab `storage` events are NOT subscribed to. sessionStorage is
  // per-tab by definition, so there is nothing to hear.
  return () => {
    listeners.delete(onChange);
  };
}

function read(key: string): string {
  try {
    return window.sessionStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function write(key: string, value: string): void {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // A selection that cannot be stored is a selection that lasts one page.
    // Worth nothing, worth no error either.
  }
}

export interface RowSelection {
  ids: string[];
  toggle: (id: string) => void;
  setPage: (pageIds: string[], selected: boolean) => void;
  clear: () => void;
}

export function useRowSelection(key: string | undefined): RowSelection {
  const raw = useSyncExternalStore(
    subscribe,
    useCallback(() => (key ? read(key) : ""), [key]),
    () => "",
  );

  const ids = useMemo(() => parseSelection(raw), [raw]);

  const store = useCallback(
    (next: string[]) => {
      if (!key) return;
      write(key, serialiseSelection(next));
      notify();
    },
    [key],
  );

  const toggle = useCallback(
    // Re-read rather than closing over `ids`: two rapid clicks in one frame
    // would otherwise both start from the same snapshot and the second would
    // undo the first.
    (id: string) =>
      store(toggleSelected(parseSelection(key ? read(key) : ""), id)),
    [key, store],
  );

  const setPage = useCallback(
    (pageIds: string[], selected: boolean) =>
      store(
        setPageSelected(
          parseSelection(key ? read(key) : ""),
          pageIds,
          selected,
        ),
      ),
    [key, store],
  );

  const clear = useCallback(() => store([]), [store]);

  return useMemo(
    () => ({ ids, toggle, setPage, clear }),
    [ids, toggle, setPage, clear],
  );
}
