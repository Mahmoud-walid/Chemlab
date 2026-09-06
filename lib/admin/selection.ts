/**
 * Which rows an operator has ticked, and what "the same list" means.
 *
 * #64 asks for selection that "persists across pagination within a view".
 * The word doing the work is **view**: page 1 select three, page 2 select two
 * more, the bar says five. Change the filter and the selection starts again —
 * and that is correct rather than a limitation. A selection made under
 * "status: draft" means nothing under "status: published"; carrying it over
 * would let somebody archive rows they were not looking at when they ticked
 * them.
 *
 * The view key is therefore every list parameter EXCEPT the page.
 */

/** Parameters that do not change which rows a view is about. */
const IGNORED = new Set(["page"]);

/**
 * A stable key for one view of one table.
 *
 * Sorted, so `?q=acid&status=draft` and `?status=draft&q=acid` are the same
 * view — they are the same list, and two selections for it would be a bug
 * nobody could see.
 */
export function viewKey(
  tableId: string,
  params: Iterable<[string, string]>,
): string {
  const parts = [...params]
    .filter(([key, value]) => !IGNORED.has(key) && value !== "")
    .map(([key, value]) => `${key}=${value}`)
    .sort();
  return `chemlab:selection:${tableId}:${parts.join("&")}`;
}

/** Ids from storage, ignoring anything unreadable. */
export function parseSelection(stored: string | null | undefined): string[] {
  if (!stored) return [];
  try {
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    return [
      ...new Set(parsed.filter((id): id is string => typeof id === "string")),
    ];
  } catch {
    return [];
  }
}

export function serialiseSelection(ids: string[]): string {
  return JSON.stringify([...new Set(ids)]);
}

/** Adds or removes one row. */
export function toggleSelected(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((held) => held !== id) : [...ids, id];
}

/**
 * Ticks or unticks every row on the current page, leaving the rest alone.
 *
 * "Leaving the rest alone" is the point: the header checkbox is about the
 * page in front of you, and an operator who selected two rows on page one
 * must not lose them by tidying up page two.
 */
export function setPageSelected(
  ids: string[],
  pageIds: string[],
  selected: boolean,
): string[] {
  if (!selected) {
    const dropping = new Set(pageIds);
    return ids.filter((id) => !dropping.has(id));
  }
  const held = new Set(ids);
  return [...ids, ...pageIds.filter((id) => !held.has(id))];
}

/** Whether the header checkbox is on, off, or in between. */
export function pageSelectionState(
  ids: string[],
  pageIds: string[],
): "none" | "some" | "all" {
  if (pageIds.length === 0) return "none";
  const held = new Set(ids);
  const count = pageIds.filter((id) => held.has(id)).length;
  if (count === 0) return "none";
  return count === pageIds.length ? "all" : "some";
}

/** How many selected rows are not on this page — the number the bar must say. */
export function offPageCount(ids: string[], pageIds: string[]): number {
  const onPage = new Set(pageIds);
  return ids.filter((id) => !onPage.has(id)).length;
}
