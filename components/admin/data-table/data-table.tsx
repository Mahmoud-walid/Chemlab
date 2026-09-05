"use client";

import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";
import { useSearchParams } from "next/navigation";

import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useDebouncedCallback } from "@/hooks/use-debounced-callback";
import { useColumnVisibility } from "@/hooks/use-column-visibility";
import type { ColumnSpec } from "@/lib/admin/column-visibility";
import { ColumnMenu } from "./column-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

/**
 * The list pattern every admin screen reuses.
 *
 * Pagination, sorting and filtering live in the URL and are executed in SQL by
 * the server component above. That is what makes a filtered view linkable and
 * reload-proof — and it is the only shape that still works when the table is
 * the activity log rather than 119 elements.
 *
 * Deliberately not `@tanstack/react-table`'s client row models: they would
 * paginate a page of rows the server already paginated, which is either a lie
 * or a second, contradictory source of truth.
 */

/**
 * How long the search box waits before asking the server.
 *
 * Long enough that ordinary typing produces one request, short enough that a
 * pause between words does not feel like a stall. Enter and blur skip it
 * entirely — see `useDebouncedCallback`.
 */
export const SEARCH_DEBOUNCE_MS = 300;

export interface DataTableColumn<TRow> {
  /** Sort key, when the column is sortable. Must be on the server's allow-list. */
  key?: string;
  /**
   * Stable id for the column-visibility preference. NOT the header, which is
   * translated: an operator who switches to Arabic would otherwise find their
   * hidden columns back.
   *
   * A column without one cannot be hidden, which is the safe default.
   */
  id?: string;
  header: string;
  cell: (row: TRow) => React.ReactNode;
  /** Right-aligned for numbers; uses logical alignment so it mirrors in RTL. */
  numeric?: boolean;
  /**
   * Carries the row's link. Put it on the column a person would read aloud to
   * identify the row — the element's NAME, not its atomic number. A link whose
   * accessible name is "1" tells a screen-reader user nothing about where it
   * goes. Defaults to the first column when no column claims it.
   */
  link?: boolean;
}

export interface DataTableLabels {
  search: string;
  searchPlaceholder: string;
  empty: string;
  previous: string;
  next: string;
  /** "Page {page} of {pages}" — already interpolated by the caller. */
  pageStatus: string;
  sortBy: string;
  columns: string;
  columnsHint: string;
  loading: string;
}

export function DataTable<TRow>({
  rows,
  columns,
  page,
  pages,
  rowKey,
  rowHref,
  tableId,
  labels,
}: {
  rows: TRow[];
  columns: DataTableColumn<TRow>[];
  page: number;
  pages: number;
  rowKey: (row: TRow) => string;
  /** Makes the whole row a link to the editor. */
  rowHref?: (row: TRow) => string;
  /**
   * Scopes the column-visibility preference. Omit it and the column menu is
   * not offered at all — a preference with no key would be shared by every
   * table on the site.
   */
  tableId?: string;
  labels: DataTableLabels;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const currentSort = searchParams.get("sort");
  const currentDirection = searchParams.get("dir") === "desc" ? "desc" : "asc";

  const withParams = useCallback(
    (changes: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(changes)) {
        if (value === null || value === "") next.delete(key);
        else next.set(key, value);
      }
      const query = next.toString();
      return query ? `${pathname}?${query}` : pathname;
    },
    [pathname, searchParams],
  );

  const search = useCallback(
    (value: string) => {
      startTransition(() => {
        // Back to the first page: staying on page 4 of a narrowed result is
        // how a search appears to return nothing.
        router.replace(withParams({ q: value || null, page: null }));
      });
    },
    [router, withParams],
  );

  // One request per pause rather than one per keystroke. At 119 elements on
  // localhost the difference is invisible; on the activity log over a phone
  // connection it is the difference between a list and a flicker.
  const onSearch = useDebouncedCallback(search, SEARCH_DEBOUNCE_MS);

  /* ------------------------------------------------ column visibility --- */

  const specs = useMemo<(ColumnSpec & { header: string })[]>(
    () =>
      columns
        .filter((column) => column.id)
        .map((column) => ({
          id: column.id!,
          link: column.link,
          header: column.header,
        })),
    [columns],
  );

  const { hidden, toggle: onToggleColumn } = useColumnVisibility(
    tableId,
    specs,
  );

  const shown = useMemo(
    () => columns.filter((column) => !column.id || !hidden.has(column.id)),
    [columns, hidden],
  );

  const sortHref = (key: string) => {
    const isCurrent = currentSort === key;
    const direction = isCurrent && currentDirection === "asc" ? "desc" : "asc";
    return withParams({
      sort: key,
      dir: direction === "asc" ? null : "desc",
      page: null,
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          defaultValue={searchParams.get("q") ?? ""}
          aria-label={labels.search}
          placeholder={labels.searchPlaceholder}
          className="max-w-xs"
          onChange={(event) => onSearch.call(event.target.value)}
          // Somebody who presses Enter has said they are done waiting, and so
          // has somebody who has moved on to another control.
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onSearch.flush();
            }
          }}
          onBlur={() => onSearch.flush()}
        />
        {tableId && specs.length > 0 && (
          <div className="ms-auto">
            <ColumnMenu
              columns={specs}
              hidden={hidden}
              onToggle={onToggleColumn}
              labels={{
                columns: labels.columns,
                columnsHint: labels.columnsHint,
              }}
            />
          </div>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              {shown.map((column) => (
                <TableHead
                  key={column.header}
                  className={column.numeric ? "text-end" : undefined}
                  // Announces the current sort to assistive tech, which a
                  // coloured chevron alone does not.
                  aria-sort={
                    column.key && currentSort === column.key
                      ? currentDirection === "asc"
                        ? "ascending"
                        : "descending"
                      : undefined
                  }
                >
                  {column.key ? (
                    <Link
                      href={sortHref(column.key)}
                      className="inline-flex items-center gap-1 hover:text-foreground"
                      aria-label={`${labels.sortBy}: ${column.header}`}
                    >
                      {column.header}
                      {currentSort === column.key ? (
                        currentDirection === "asc" ? (
                          <ArrowUp className="size-3.5" aria-hidden />
                        ) : (
                          <ArrowDown className="size-3.5" aria-hidden />
                        )
                      ) : (
                        <ArrowUpDown
                          className="size-3.5 opacity-40"
                          aria-hidden
                        />
                      )}
                    </Link>
                  ) : (
                    column.header
                  )}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>

          <TableBody>
            {pending ? (
              // A skeleton with the same column count and roughly the same row
              // count as what is being replaced, so the page does not jump and
              // then jump back. Dimming the old rows instead showed stale data
              // that still looked clickable.
              <TableSkeleton
                columns={shown.length}
                rows={Math.max(rows.length, 3)}
                label={labels.loading}
              />
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={shown.length}
                  className="py-10 text-center text-sm text-muted-foreground"
                >
                  {labels.empty}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => {
                const href = rowHref?.(row);
                // Against the VISIBLE columns: with the link column hidden
                // the index would point at whichever column happened to take
                // its place, and a link would appear on the wrong one. It
                // cannot be hidden today — `isLocked` refuses — and this is
                // what keeps that from being load-bearing.
                const linkIndex = Math.max(
                  0,
                  shown.findIndex((column) => column.link),
                );
                return (
                  <TableRow key={rowKey(row)}>
                    {shown.map((column, index) => (
                      <TableCell
                        key={column.header}
                        className={column.numeric ? "text-end" : undefined}
                      >
                        {/* The link is on one cell rather than the row:
                            a clickable <tr> is unreachable by keyboard and
                            invisible to a screen reader. */}
                        {index === linkIndex && href ? (
                          <Link
                            href={href}
                            className="font-medium underline-offset-4 hover:underline"
                          >
                            {column.cell(row)}
                          </Link>
                        ) : (
                          column.cell(row)
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">{labels.pageStatus}</p>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild disabled={page <= 1}>
            <Link
              href={withParams({ page: page > 2 ? String(page - 1) : null })}
              aria-disabled={page <= 1}
              className={cn(page <= 1 && "pointer-events-none opacity-50")}
            >
              {labels.previous}
            </Link>
          </Button>
          <Button variant="outline" size="sm" asChild disabled={page >= pages}>
            <Link
              href={withParams({ page: String(page + 1) })}
              aria-disabled={page >= pages}
              className={cn(page >= pages && "pointer-events-none opacity-50")}
            >
              {labels.next}
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Placeholder rows during a transition.
 *
 * Matching the column count is the whole point: a skeleton with the wrong
 * shape moves the layout twice — once for itself and once for the real rows.
 */
function TableSkeleton({
  columns,
  rows,
  label,
}: {
  columns: number;
  rows: number;
  label: string;
}) {
  return (
    <>
      {Array.from({ length: rows }, (_, rowIndex) => (
        <TableRow key={rowIndex}>
          {Array.from({ length: columns }, (_, cellIndex) => (
            <TableCell key={cellIndex}>
              <Skeleton className="h-4 w-full max-w-[12ch]" />
              {/* Announced once, not once per cell. `aria-busy` on the table
                  would tell a screen reader nothing about what is happening. */}
              {rowIndex === 0 && cellIndex === 0 && (
                <span role="status" className="sr-only">
                  {label}
                </span>
              )}
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}
