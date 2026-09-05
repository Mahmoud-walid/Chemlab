/**
 * When windowing is worth its costs.
 *
 * Virtualization is not free, and the price is paid in things people rely on
 * without thinking about them:
 *
 * - **Find-in-page stops working.** Off-screen comments are not in the DOM, so
 *   the browser cannot search them. There is no way to have both windowing and
 *   complete in-page find.
 * - **Anchor links break.** `#comment-abc` cannot scroll to a node that is not
 *   mounted, so a deep link has to resolve an index and scroll to it.
 * - **A screen reader hears a partial list**, unless the container declares
 *   the true size rather than the loaded one.
 * - **Printing produces a partial document.**
 *
 * So it is CONDITIONAL: below the threshold the list is plain DOM and has none
 * of these problems, which is the case for almost every lesson. The threshold
 * counts RENDERED NODES — roots plus their visible replies — because that is
 * what costs layout, not the number of top-level comments.
 *
 * Pure, so both branches are decidable in a test without mounting anything.
 */

/**
 * Where plain DOM stops being cheap.
 *
 * A hundred comment nodes is roughly a thousand elements with avatars and
 * buttons. Below that a browser lays out the lot in a frame and nobody
 * notices; above it, scrolling on a mid-range phone starts to stutter.
 */
export const VIRTUALIZE_ABOVE = 100;

/** An estimate, corrected by measurement once each row renders. Chosen from a
 * two-line comment with an avatar and a row of buttons — the common case, so
 * most rows need the smallest correction. */
export const ESTIMATED_ROW_HEIGHT = 132;

export interface Countable {
  replies?: unknown[];
}

/** Rendered nodes, not top-level comments: a thread of one root and forty
 * replies costs forty-one rows to lay out. */
export function renderedNodes(roots: readonly Countable[]): number {
  return roots.reduce(
    (total, root) => total + 1 + (root.replies?.length ?? 0),
    0,
  );
}

export function shouldVirtualize(
  roots: readonly Countable[],
  threshold: number = VIRTUALIZE_ABOVE,
): boolean {
  return renderedNodes(roots) > threshold;
}

/**
 * Whether a deep link can be honoured by scrolling alone.
 *
 * When the target is not among the loaded rows the caller must fetch further
 * pages first — scrolling to an index that does not exist yet silently does
 * nothing, which reads as a broken link.
 */
export function indexOfComment(
  roots: readonly { id: string }[],
  commentId: string,
): number | null {
  const index = roots.findIndex((root) => root.id === commentId);
  return index === -1 ? null : index;
}

/** The `#comment-<id>` a URL fragment names, or null when it names something
 * else. Parsed rather than assumed, because the fragment is user input. */
export function commentIdFromHash(hash: string): string | null {
  const match = /^#comment-([A-Za-z0-9_-]{1,64})$/.exec(hash);
  return match ? match[1]! : null;
}
