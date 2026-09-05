import "server-only";
import { asc, count, desc, ilike, or, sql, type SQL } from "drizzle-orm";

import { getDb } from "@/db/client";
import { elements } from "@/db/schema/content";
import { offsetFor, pageCount, type ListParams } from "./list-params";

/**
 * Elements for the admin list.
 *
 * Pagination, sorting and filtering all happen in SQL, not in the browser.
 * 119 elements would survive being sent whole; the activity log will not, and
 * two patterns for the same job is one more than anyone will keep correct.
 */

export const ELEMENT_SORT_COLUMNS = [
  "number",
  "name",
  "symbol",
  "category",
  "atomicMass",
] as const;

export type ElementSort = (typeof ELEMENT_SORT_COLUMNS)[number];

export const ELEMENT_LIST_SPEC = {
  sortable: ELEMENT_SORT_COLUMNS,
  defaultSort: "number" as const,
};

export interface ElementRow {
  number: number;
  symbol: string;
  name: string;
  category: string;
  atomicMass: number;
  phase: string;
  updatedAt: Date;
}

export interface ElementPage {
  rows: ElementRow[];
  total: number;
  pages: number;
}

/** The column to order by. Resolved from an allow-list, never from raw input. */
function orderColumn(sort: ElementSort) {
  switch (sort) {
    case "name":
      return elements.name;
    case "symbol":
      return elements.symbol;
    case "category":
      return elements.category;
    case "atomicMass":
      return elements.atomicMass;
    default:
      return elements.number;
  }
}

function searchFilter(query: string): SQL | undefined {
  if (!query) return undefined;
  const pattern = `%${query}%`;
  // ILIKE rather than a full-text index: 119 rows, and an operator searching
  // for "iro" expects a substring match, not a stemmed word match.
  return or(
    ilike(elements.name, pattern),
    ilike(elements.symbol, pattern),
    ilike(elements.category, pattern),
  );
}

export async function listElementsForAdmin(
  params: ListParams<ElementSort>,
): Promise<ElementPage> {
  const db = getDb();
  const where = searchFilter(params.query);
  const order = params.direction === "desc" ? desc : asc;

  const [{ total }] = await db
    .select({ total: count() })
    .from(elements)
    .where(where);

  const rows = await db
    .select({
      number: elements.number,
      symbol: elements.symbol,
      name: elements.name,
      category: elements.category,
      atomicMass: elements.atomicMass,
      phase: elements.phase,
      updatedAt: elements.updatedAt,
    })
    .from(elements)
    .where(where)
    .orderBy(
      order(orderColumn(params.sort)),
      // A stable tiebreak, so two elements sharing a category do not swap
      // places between pages and make a row appear twice or not at all.
      asc(elements.number),
    )
    .limit(params.pageSize)
    .offset(offsetFor(params.page, params.pageSize, total ?? 0));

  return {
    rows,
    total: total ?? 0,
    pages: pageCount(total ?? 0, params.pageSize),
  };
}

/** One element by its atomic number — the natural key the editor is keyed on. */
export async function getElementByNumber(number: number) {
  const [row] = await getDb()
    .select()
    .from(elements)
    .where(sql`${elements.number} = ${number}`)
    .limit(1);
  return row ?? null;
}

/** The distinct categories, for the filter menu. */
export async function listElementCategories(): Promise<string[]> {
  const rows = await getDb()
    .selectDistinct({ category: elements.category })
    .from(elements)
    .orderBy(asc(elements.category));
  return rows.map((row) => row.category);
}
