"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Infinite scroll over a list that is already here.
 *
 * The reader-facing catalogues arrive whole from the server, so "load more" is
 * a reveal rather than a fetch. That removes the failure modes that make
 * infinite scroll unpleasant — no spinner that never resolves, no duplicate
 * page when two requests race, nothing lost when the connection drops — and
 * leaves only the two that matter: resetting when the list changes, and being
 * reachable without a mouse.
 *
 * **The sentinel is a real button.** Not an empty div: `IntersectionObserver`
 * is missing in jsdom and in older browsers, and a reader who cannot trigger
 * the observer must still be able to reach item 15. Pressing it does exactly
 * what scrolling past it does, so keyboard and screen-reader users get the
 * whole catalogue rather than the first page of it.
 */
export interface InfiniteReveal<T> {
  /** The prefix of `items` to render. */
  visible: readonly T[];
  /** Whether anything is still hidden — render the sentinel only then. */
  hasMore: boolean;
  /** How many are hidden, for the sentinel's own label. */
  remaining: number;
  /** Attach to the sentinel element. */
  sentinelRef: (node: HTMLElement | null) => void;
  /** Reveal one more page. Wire this to the sentinel's `onClick`. */
  revealMore: () => void;
}

/**
 * How far ahead of the viewport the next page is revealed.
 *
 * Generous on purpose: the point of infinite scroll is that the reader never
 * meets the end of the list, and a margin of zero reveals the next page only
 * once the sentinel is already on screen — which is a visible stutter at the
 * bottom of every page.
 */
const LOOKAHEAD = "600px";

export function useInfiniteReveal<T>({
  items,
  pageSize,
  resetKey,
}: {
  items: readonly T[];
  pageSize: number;
  /**
   * A string identifying the current list. When it changes, the reveal starts
   * over at one page.
   *
   * Passed in rather than derived from `items`, and that is the whole
   * correctness argument of this hook. Somebody who has scrolled to lesson 40
   * and then types a search must not be handed 40 results — and must not be
   * handed a flash of them either, which is what resetting from an effect
   * does: the render before the effect has already painted the long list.
   * Comparing the key during render means the first render of a new list is
   * already one page long.
   */
  resetKey: string;
}): InfiniteReveal<T> {
  // The key travels WITH the count so a stale count is recognisable rather
  // than corrected. No `setState` during render, no effect, no flash.
  const [reveal, setReveal] = useState({ key: resetKey, count: pageSize });
  const count = reveal.key === resetKey ? reveal.count : pageSize;

  const hasMore = count < items.length;

  const revealMore = useCallback(() => {
    setReveal({ key: resetKey, count: count + pageSize });
  }, [resetKey, count, pageSize]);

  // Held in state, not a ref: the effect below has to re-run when the node
  // appears, and a ref assignment does not re-render.
  const [sentinel, setSentinel] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!sentinel || !hasMore) return;
    if (typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) revealMore();
      },
      { rootMargin: LOOKAHEAD },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [sentinel, hasMore, revealMore]);

  return {
    visible: items.slice(0, count),
    hasMore,
    remaining: Math.max(0, items.length - count),
    sentinelRef: setSentinel,
    revealMore,
  };
}
