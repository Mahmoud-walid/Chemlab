"use client";

import {
  DataTable,
  type DataTableLabels,
} from "@/components/admin/data-table/data-table";
import { Badge } from "@/components/ui/badge";

export interface ActivityTableRow {
  id: string;
  verb: string;
  verbLabel: string;
  group: string;
  actorLabel: string;
  objectLabel: string;
  /** Null when the reader does not hold `activity:read_pii`. */
  ipAddress: string | null;
  userAgent: string | null;
  whenLabel: string;
}

export interface ActivityTableLabels {
  when: string;
  actor: string;
  verb: string;
  object: string;
  ip: string;
  agent: string;
  withheld: string;
  table: DataTableLabels;
}

export function ActivityTable({
  rows,
  page,
  pages,
  canSeePii,
  labels,
}: {
  rows: ActivityTableRow[];
  page: number;
  pages: number;
  canSeePii: boolean;
  labels: ActivityTableLabels;
}) {
  return (
    <DataTable
      tableId="activity"
      rows={rows}
      page={page}
      pages={pages}
      rowKey={(row) => row.id}
      labels={labels.table}
      columns={[
        { id: "when", header: labels.when, cell: (row) => row.whenLabel },
        { id: "actor", header: labels.actor, cell: (row) => row.actorLabel },
        {
          id: "verb",
          header: labels.verb,
          cell: (row) => <Badge variant="secondary">{row.verbLabel}</Badge>,
        },
        { id: "object", header: labels.object, cell: (row) => row.objectLabel },
        // The personal-data columns render only for a reader who may see them.
        // They are already null in the query for everyone else — this keeps the
        // table from showing two empty columns to every other reader, which
        // would advertise data they cannot have rather than withhold it.
        ...(canSeePii
          ? [
              {
                id: "ip",
                header: labels.ip,
                cell: (row: ActivityTableRow) => row.ipAddress ?? "—",
              },
              {
                id: "agent",
                header: labels.agent,
                cell: (row: ActivityTableRow) => (
                  <span
                    className="block max-w-[16rem] truncate text-xs text-muted-foreground"
                    title={row.userAgent ?? undefined}
                  >
                    {row.userAgent ?? "—"}
                  </span>
                ),
              },
            ]
          : []),
      ]}
    />
  );
}
