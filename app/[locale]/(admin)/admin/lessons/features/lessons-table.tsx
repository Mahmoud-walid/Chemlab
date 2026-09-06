"use client";

import {
  DataTable,
  type DataTableLabels,
} from "@/components/admin/data-table/data-table";
import { TranslationBadge } from "@/components/admin/translation-badge";
import { Badge } from "@/components/ui/badge";
import type { ContentStatus } from "@/db/schema/content";
import type { TranslationState } from "@/lib/translations/state";

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
  /** Absent when no locale is being tracked — then the column is not shown. */
  translation?: TranslationState;
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
  /** Column header — the language's own name, e.g. "Arabic". */
  translation?: string;
  translationNames?: Record<TranslationState, string>;
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
      tableId="lessons"
      rows={rows}
      page={page}
      pages={pages}
      rowKey={(row) => row.id}
      rowHref={(row) => `/admin/lessons/${row.slug}`}
      labels={labels.table}
      columns={[
        {
          key: "position",
          id: "position",
          header: labels.position,
          numeric: true,
          cell: (row) => row.position,
        },
        {
          key: "title",
          id: "title",
          header: labels.title,
          // The link lives here: the title identifies the lesson, its
          // ordinal position does not.
          link: true,
          cell: (row) => row.title,
        },
        {
          key: "category",
          id: "category",
          header: labels.category,
          cell: (row) => row.category,
        },
        {
          key: "difficulty",
          id: "difficulty",
          header: labels.difficulty,
          cell: (row) => row.difficulty,
        },
        {
          key: "status",
          id: "status",
          header: labels.status,
          cell: (row) => (
            <Badge variant={STATUS_VARIANT[row.status]}>
              {labels.statusNames[row.status]}
            </Badge>
          ),
        },
        {
          id: "content",
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
        // Conditional, not hidden with CSS: when there is no second locale
        // there is no question to answer, and an empty column is worse than
        // no column.
        ...(labels.translation && labels.translationNames
          ? [
              {
                key: "translation",
                id: "translation",
                header: labels.translation,
                cell: (row: LessonTableRow) =>
                  row.translation ? (
                    <TranslationBadge
                      state={row.translation}
                      label={labels.translationNames![row.translation]}
                    />
                  ) : null,
              },
            ]
          : []),
        {
          id: "updated",
          header: labels.updated,
          cell: (row) => row.updatedLabel,
        },
      ]}
    />
  );
}
