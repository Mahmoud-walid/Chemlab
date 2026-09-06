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
import { bulkQuizAction } from "../actions";
import { TranslationBadge } from "@/components/admin/translation-badge";
import { Badge } from "@/components/ui/badge";
import type { TranslationState } from "@/lib/translations/state";
import type { ContentStatus } from "@/db/schema/content";

export interface QuizTableRow {
  id: string;
  slug: string;
  title: string;
  category: string;
  difficulty: string;
  status: ContentStatus;
  position: number;
  questionCount: number;
  /** Already pluralised on the server — a formatter cannot cross this boundary. */
  questionsLabel: string;
  /** Absent when no locale is being tracked — then the column is not shown. */
  translation?: TranslationState;
  updatedLabel: string;
}

export interface QuizTableLabels {
  position: string;
  title: string;
  category: string;
  difficulty: string;
  status: string;
  questions: string;
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

const STATUS_VARIANT: Record<
  ContentStatus,
  "default" | "secondary" | "outline"
> = {
  published: "default",
  draft: "secondary",
  archived: "outline",
};

export function QuizzesTable({
  rows,
  page,
  pages,
  can,
  labels,
}: {
  rows: QuizTableRow[];
  page: number;
  pages: number;
  /** Which bulk actions to offer. Absent means selection is not offered. */
  can?: { publish: boolean; withdraw: boolean };
  labels: QuizTableLabels;
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
      const result = await bulkQuizAction(
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
        tableId="quizzes"
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
        rowHref={(row) => `/admin/quizzes/${row.slug}`}
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
            id: "questions",
            header: labels.questions,
            numeric: true,
            // Shown in the list because zero is the one value that stops a quiz
            // being published, and finding that out by clicking publish and
            // being refused is a worse way to learn it.
            cell: (row) =>
              row.questionCount === 0 ? (
                <span className="text-muted-foreground">
                  {row.questionsLabel}
                </span>
              ) : (
                row.questionsLabel
              ),
          },
          // Conditional, not hidden with CSS: with no second locale there is
          // no question to answer, and an empty column is worse than none.
          ...(labels.translation && labels.translationNames
            ? [
                {
                  key: "translation",
                  id: "translation",
                  header: labels.translation,
                  cell: (row: QuizTableRow) =>
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
