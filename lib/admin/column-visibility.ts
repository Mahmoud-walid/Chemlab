/**
 * Which columns of an admin table a viewer has chosen to see.
 *
 * Stored in `localStorage`, and that is the right store: this is a per-viewer
 * convenience, not shared state. Nobody else needs to know that one operator
 * hides the "Updated" column, and nothing breaks if the setting is lost.
 *
 * Two rules the pure functions here enforce, both of which exist because the
 * failure is silent:
 *
 * - **The link column can never be hidden.** It carries the only way into the
 *   row's editor. Hiding it leaves a table that looks fine and cannot be used,
 *   and the person who did it has no obvious way back.
 * - **Anything unreadable means "all columns".** Storage that throws, JSON
 *   that does not parse, a key naming columns that no longer exist — every one
 *   of those must show the whole table rather than an empty one.
 */

export interface ColumnSpec {
  /** Stable across renders and locales: NOT the translated header. */
  id: string;
  /** True for the column carrying the row's link. */
  link?: boolean;
  /** True for a column that cannot be hidden for another reason. */
  required?: boolean;
}

/** The localStorage key for one table. */
export function visibilityKey(tableId: string): string {
  return `chemlab:columns:${tableId}`;
}

/** A column nobody may hide. */
export function isLocked(column: ColumnSpec): boolean {
  return Boolean(column.link || column.required);
}

/**
 * The set of hidden column ids, from whatever was stored.
 *
 * Unknown ids are dropped rather than kept: a column removed from the table
 * and later re-added under the same id would come back hidden, which reads as
 * the new column not working.
 */
export function parseHidden(
  stored: string | null | undefined,
  columns: ColumnSpec[],
): Set<string> {
  if (!stored) return new Set();

  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    return new Set();
  }
  if (!Array.isArray(parsed)) return new Set();

  const known = new Map(columns.map((column) => [column.id, column]));
  return new Set(
    parsed.filter(
      (id): id is string =>
        typeof id === "string" &&
        known.has(id) &&
        // Enforced on read as well as on write. A hand-edited storage entry,
        // or one written before a column became the link column, must not be
        // able to hide the way into the row.
        !isLocked(known.get(id)!),
    ),
  );
}

/** Serialised for storage. Sorted, so an unchanged set writes an equal string. */
export function serialiseHidden(hidden: Set<string>): string {
  return JSON.stringify([...hidden].sort());
}

/** Flips one column, refusing to hide a locked one. */
export function toggleHidden(
  hidden: Set<string>,
  column: ColumnSpec,
): Set<string> {
  const next = new Set(hidden);
  if (next.has(column.id)) next.delete(column.id);
  else if (!isLocked(column)) next.add(column.id);
  return next;
}

/**
 * The raw stored string, surviving a storage that throws.
 *
 * Raw rather than parsed because the caller is `useSyncExternalStore`, which
 * compares snapshots by identity: returning a fresh `Set` on every read is an
 * infinite render loop. Parsing happens once, downstream, memoised.
 *
 * Private browsing, cleared site data and browsers configured to block
 * storage all make the accessor itself throw rather than return null —
 * including during a thumbnail capture, where nobody is even looking.
 */
export function readRaw(
  key: string,
  storage: Pick<Storage, "getItem"> | undefined = safeStorage(),
): string {
  try {
    return storage?.getItem(key) ?? "";
  } catch {
    return "";
  }
}

/** Writes it, and says nothing if it cannot. Losing a preference is not an error. */
export function writeRaw(
  key: string,
  value: string,
  storage: Pick<Storage, "setItem"> | undefined = safeStorage(),
): void {
  try {
    storage?.setItem(key, value);
  } catch {
    // Deliberately silent.
  }
}

function safeStorage(): Storage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}
