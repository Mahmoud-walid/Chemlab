"use client";

import {
  DataTable,
  type DataTableLabels,
} from "@/components/admin/data-table/data-table";
import { Badge } from "@/components/ui/badge";
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
      rows={rows}
      page={page}
      pages={pages}
      rowKey={(row) => row.id}
      rowHref={(row) => `/admin/quizzes/${row.slug}`}
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
        { header: labels.updated, cell: (row) => row.updatedLabel },
      ]}
    />
  );
}
