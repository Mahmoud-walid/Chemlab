"use client";

import {
  DataTable,
  type DataTableLabels,
} from "@/components/admin/data-table/data-table";
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
  labels,
}: {
  rows: QuizTableRow[];
  page: number;
  pages: number;
  labels: QuizTableLabels;
}) {
  return (
    <DataTable
      tableId="quizzes"
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
  );
}
