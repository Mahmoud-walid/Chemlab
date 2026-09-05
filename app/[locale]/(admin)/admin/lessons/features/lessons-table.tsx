"use client";

import {
  DataTable,
  type DataTableLabels,
} from "@/components/admin/data-table/data-table";
import { Badge } from "@/components/ui/badge";
import type { ContentStatus } from "@/db/schema/content";

export interface LessonTableRow {
  id: string;
  slug: string;
  title: string;
  category: string;
  difficulty: string;
  status: ContentStatus;
  position: number;
  sectionCount: number;
  /** Already pluralised on the server — "5 sections", or the empty label. */
  contentLabel: string;
  updatedLabel: string;
}

export interface LessonTableLabels {
  position: string;
  title: string;
  category: string;
  difficulty: string;
  status: string;
  content: string;
  updated: string;
  statusNames: Record<ContentStatus, string>;
  table: DataTableLabels;
}

/**
 * Status as a badge with a variant, not a coloured dot: colour alone is not a
 * label, and "draft" has to be readable by someone who cannot tell the two
 * greens apart.
 */
const STATUS_VARIANT: Record<
  ContentStatus,
  "default" | "secondary" | "outline"
> = {
  published: "default",
  draft: "secondary",
  archived: "outline",
};

export function LessonsTable({
  rows,
  page,
  pages,
  labels,
}: {
  rows: LessonTableRow[];
  page: number;
  pages: number;
  labels: LessonTableLabels;
}) {
  return (
    <DataTable
      rows={rows}
      page={page}
      pages={pages}
      rowKey={(row) => row.id}
      rowHref={(row) => `/admin/lessons/${row.slug}`}
      labels={labels.table}
      columns={[
        {
          key: "position",
          header: labels.position,
          numeric: true,
          cell: (row) => row.position,
        },
        {
          key: "title",
          header: labels.title,
          // The link lives here: the title identifies the lesson, its
          // ordinal position does not.
          link: true,
          cell: (row) => row.title,
        },
        {
          key: "category",
          header: labels.category,
          cell: (row) => row.category,
        },
        {
          key: "difficulty",
          header: labels.difficulty,
          cell: (row) => row.difficulty,
        },
        {
          key: "status",
          header: labels.status,
          cell: (row) => (
            <Badge variant={STATUS_VARIANT[row.status]}>
              {labels.statusNames[row.status]}
            </Badge>
          ),
        },
        {
          header: labels.content,
          // Shown in the list rather than only on the editor: a lesson with no
          // sections cannot be published, and finding that out by clicking
          // publish and being refused is a worse way to learn it.
          cell: (row) =>
            row.sectionCount === 0 ? (
              <span className="text-muted-foreground">{row.contentLabel}</span>
            ) : (
              row.contentLabel
            ),
        },
        { header: labels.updated, cell: (row) => row.updatedLabel },
      ]}
    />
  );
}
