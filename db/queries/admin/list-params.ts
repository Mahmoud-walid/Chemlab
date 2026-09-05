/**
 * List state — page, sort, filter — parsed from and serialised back to the URL.
 *
 * The URL is the source of truth, deliberately. A filtered view is then
 * linkable, survives a reload, and can be sent to someone else; component
 * state would lose all three the moment the page re-renders on the server.
 *
 * Pure, so the parsing rules can be tested without a request.
 */

export const DEFAULT_PAGE_SIZE = 25;
const PAGE_SIZES = [10, 25, 50, 100];
const MAX_QUERY_LENGTH = 100;

export interface ListParams<TSort extends string = string> {
  page: number;
  pageSize: number;
  sort: TSort;
  direction: "asc" | "desc";
  query: string;
}

export interface ListParamsSpec<TSort extends string> {
  /** The columns this table may be sorted by. Anything else is rejected. */
  sortable: readonly TSort[];
  defaultSort: TSort;
  defaultDirection?: "asc" | "desc";
}

/** A single value from Next's `searchParams`, which may be an array. */
type RawParam = string | string[] | undefined;

function first(value: RawParam): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Parses list state, clamping everything to something safe.
 *
 * `sort` is checked against an allow-list rather than passed through: it names
 * a column, and a value taken straight from the query string into an ORDER BY
 * is how a query string becomes SQL injection. A page below 1 or a page size
 * off the menu is a typo or a probe, and either way the answer is the default
 * rather than an error page.
 */
export function parseListParams<TSort extends string>(
  raw: Record<string, RawParam>,
  spec: ListParamsSpec<TSort>,
): ListParams<TSort> {
  const pageValue = Number(first(raw.page));
  const page = Number.isInteger(pageValue) && pageValue > 0 ? pageValue : 1;

  const sizeValue = Number(first(raw.pageSize));
  const pageSize = PAGE_SIZES.includes(sizeValue)
    ? sizeValue
    : DEFAULT_PAGE_SIZE;

  const sortValue = first(raw.sort);
  const sort = spec.sortable.includes(sortValue as TSort)
    ? (sortValue as TSort)
    : spec.defaultSort;

  const directionValue = first(raw.dir);
  const direction =
    directionValue === "asc" || directionValue === "desc"
      ? directionValue
      : (spec.defaultDirection ?? "asc");

  const query = (first(raw.q) ?? "").trim().slice(0, MAX_QUERY_LENGTH);

  return { page, pageSize, sort, direction, query };
}

/**
 * Serialises list state back into a query string, omitting anything that is
 * already the default — so the common view has a clean URL rather than five
 * redundant parameters.
 */
export function listParamsToQuery<TSort extends string>(
  params: Partial<ListParams<TSort>>,
  spec: ListParamsSpec<TSort>,
): string {
  const search = new URLSearchParams();

  if (params.page && params.page > 1) search.set("page", String(params.page));
  if (params.pageSize && params.pageSize !== DEFAULT_PAGE_SIZE) {
    search.set("pageSize", String(params.pageSize));
  }
  if (params.sort && params.sort !== spec.defaultSort) {
    search.set("sort", params.sort);
  }
  if (
    params.direction &&
    params.direction !== (spec.defaultDirection ?? "asc")
  ) {
    search.set("dir", params.direction);
  }
  if (params.query) search.set("q", params.query);

  const serialised = search.toString();
  return serialised ? `?${serialised}` : "";
}

/** Page count for a total, never below 1 so the UI always has a page to show. */
export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

/** The SQL offset for a page, clamped so an over-large page shows the last one. */
export function offsetFor(
  page: number,
  pageSize: number,
  total: number,
): number {
  const lastPage = pageCount(total, pageSize);
  return (Math.min(page, lastPage) - 1) * pageSize;
}
