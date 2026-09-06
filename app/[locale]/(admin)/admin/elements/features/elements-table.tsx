"use client";

import {
  DataTable,
  type DataTableLabels,
} from "@/components/admin/data-table/data-table";

export interface ElementTableRow {
  number: number;
  symbol: string;
  name: string;
  category: string;
  atomicMassLabel: string;
  phase: string;
  updatedLabel: string;
}

/**
 * The element list.
 *
 * Sort keys match the server's allow-list exactly; anything else is ignored
 * there rather than trusted here.
 */
export function ElementsTable({
  rows,
  page,
  pages,
  labels,
}: {
  rows: ElementTableRow[];
  page: number;
  pages: number;
  labels: {
    number: string;
    symbol: string;
    name: string;
    category: string;
    atomicMass: string;
    updated: string;
    table: DataTableLabels;
  };
}) {
  return (
    <DataTable
      tableId="elements"
      rows={rows}
      page={page}
      pages={pages}
      rowKey={(row) => String(row.number)}
      rowHref={(row) => `/admin/elements/${row.number}`}
      labels={labels.table}
      columns={[
        {
          key: "number",
          id: "number",
          header: labels.number,
          numeric: true,
          cell: (row) => row.number,
        },
        {
          key: "symbol",
          id: "symbol",
          header: labels.symbol,
          cell: (row) => row.symbol,
        },
        {
          key: "name",
          id: "name",
          header: labels.name,
          // The link lives here: "Iron" identifies the row, "26" does not.
          link: true,
          cell: (row) => row.name,
        },
        {
          key: "category",
          id: "category",
          header: labels.category,
          cell: (row) => row.category,
        },
        {
          key: "atomicMass",
          id: "atomicMass",
          header: labels.atomicMass,
          numeric: true,
          cell: (row) => row.atomicMassLabel,
        },
        {
          id: "updated",
          header: labels.updated,
          cell: (row) => row.updatedLabel,
        },
      ]}
    />
  );
}
