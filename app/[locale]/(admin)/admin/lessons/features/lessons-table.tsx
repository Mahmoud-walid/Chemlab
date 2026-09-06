"use client";

import { useState, useTransition } from "react";

import {
  BulkBar,
  type BulkBarLabels,
} from "@/components/admin/data-table/bulk-bar";
import {
  DataTable,
  type DataTableLabels,
} from "@/components/admin/data-table/data-table";
import { toast } from "@/components/ui/sonner";
import type { BulkRefusal } from "@/lib/admin/bulk";
import { bulkLessonAction } from "../actions";
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
  bulk?: BulkBarLabels & {
    publish: string;
    archive: string;
    withdraw: string;
    applied: string;
    unchanged: string;
  };
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
  can,
  labels,
}: {
  rows: LessonTableRow[];
  page: number;
  pages: number;
  /** Which bulk actions to offer. Absent means selection is not offered. */
  can?: { publish: boolean; withdraw: boolean };
  labels: LessonTableLabels;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  // Handed over by the table, which owns the storage key. Clearing it any
  // other way either misses the stored copy or wipes every other table's.
  const [clearSelection, setClearSelection] = useState<() => void>(
    () => () => {},
  );
  const [refusals, setRefusals] = useState<BulkRefusal[]>([]);
  const [pending, startTransition] = useTransition();

  const bulk = labels.bulk;
  const selectable = Boolean(bulk && can && (can.publish || can.withdraw));

  const apply = (action: string) => {
    // Cleared first: leaving the previous refusals on screen while the next
    // attempt runs makes it impossible to tell which attempt they belong to.
    setRefusals([]);
    startTransition(async () => {
      const result = await bulkLessonAction(
        selected,
        action as "publish" | "archive" | "withdraw",
      );

      if (!result.ok) {
        setRefusals(result.refused);
        if (result.problem) {
          toast.error({ title: result.problem, description: "" });
        }
        return;
      }

      // Both numbers, because they add up to what was selected. "37 changed"
      // over a selection of forty invites the question this answers.
      toast.success({
        title: bulk!.applied.replace("{count}", String(result.applied)),
        description:
          result.unchanged > 0
            ? bulk!.unchanged.replace("{count}", String(result.unchanged))
            : "",
      });
    });
  };

  return (
    <>
      {bulk && selectable && (
        <BulkBar
          count={selected.length}
          offPage={
            selected.filter((id) => !rows.some((row) => row.id === id)).length
          }
          pending={pending}
          refusals={refusals}
          onApply={apply}
          onClear={() => {
            clearSelection();
            setRefusals([]);
          }}
          actions={[
            ...(can!.publish
              ? [
                  { id: "publish", label: bulk.publish },
                  { id: "archive", label: bulk.archive },
                ]
              : []),
            ...(can!.withdraw
              ? [
                  {
                    id: "withdraw",
                    label: bulk.withdraw,
                    confirm: true,
                    variant: "destructive" as const,
                  },
                ]
              : []),
          ]}
          labels={bulk}
        />
      )}

      <DataTable
        tableId="lessons"
        selectable={selectable}
        onSelectionChange={({ ids, clear }) => {
          setSelected(ids);
          // Wrapped: `useState` calls a bare function argument as an updater.
          setClearSelection(() => clear);
        }}
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
                <span className="text-muted-foreground">
                  {row.contentLabel}
                </span>
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
    </>
  );
}
