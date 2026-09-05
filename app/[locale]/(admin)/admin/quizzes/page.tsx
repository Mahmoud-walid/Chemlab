import {
  getFormatter,
  getTranslations,
  setRequestLocale,
} from "next-intl/server";

import {
  QUIZ_LIST_SPEC,
  listQuizzesForAdmin,
  type QuizSort,
} from "@/db/queries/admin/quizzes";
import { parseListParams } from "@/db/queries/admin/list-params";
import type { ContentStatus } from "@/db/schema/content";
import { requireAdminPermission } from "@/lib/admin/guard";
import { hasPermission } from "@/lib/authz";
import { StatusFilter } from "@/components/admin/status-filter";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { QuizzesTable } from "./features/quizzes-table";

export const dynamic = "force-dynamic";

const STATUSES = ["draft", "published", "archived"] as const;

/** The `?status=` value, or undefined for "all". Anything unknown is "all". */
function statusFilter(raw: string | string[] | undefined) {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return STATUSES.includes(value as ContentStatus)
    ? (value as ContentStatus)
    : undefined;
}

export default async function AdminQuizzesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);

  // Its own gate. The layout checked `admin:access`; reading unpublished
  // quizzes needs `quiz:read`, and a page that leans on its parent is one
  // refactor away from being unprotected.
  const actor = await requireAdminPermission("quiz:read");
  const canCreate = hasPermission(actor, "quiz:create");

  const raw = await searchParams;
  const list = parseListParams<QuizSort>(raw, QUIZ_LIST_SPEC);
  const status = statusFilter(raw.status);
  const { rows, total, pages } = await listQuizzesForAdmin(list, status);

  const t = await getTranslations("admin.quizzes");
  const tTable = await getTranslations("admin.table");
  const format = await getFormatter();

  const statusNames = {
    draft: t("status.draft"),
    published: t("status.published"),
    archived: t("status.archived"),
  } as const;

  const difficultyNames = {
    easy: t("difficulty.easy"),
    medium: t("difficulty.medium"),
    hard: t("difficulty.hard"),
  } as const;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("subtitle", { count: format.number(total) })}
          </p>
        </div>
        {canCreate && (
          <Button asChild>
            <Link href="/admin/quizzes/new">{t("new")}</Link>
          </Button>
        )}
      </div>

      <StatusFilter
        label={t("filterByStatus")}
        current={status ?? "all"}
        options={[
          { value: "all", label: t("status.all") },
          ...STATUSES.map((value) => ({ value, label: statusNames[value] })),
        ]}
      />

      <QuizzesTable
        rows={rows.map((row) => ({
          ...row,
          difficulty: difficultyNames[row.difficulty],
          // Pluralised here rather than in the table: next-intl's plural rules
          // belong to the request's locale, and a formatting FUNCTION cannot
          // cross into a client component.
          questionsLabel:
            row.questionCount === 0
              ? t("noQuestions")
              : t("questionCount", { count: row.questionCount }),
          updatedLabel: format.dateTime(row.updatedAt, { dateStyle: "medium" }),
        }))}
        page={list.page}
        pages={pages}
        labels={{
          position: t("columns.position"),
          title: t("columns.title"),
          category: t("columns.category"),
          difficulty: t("columns.difficulty"),
          status: t("columns.status"),
          questions: t("columns.questions"),
          updated: t("columns.updated"),
          statusNames,
          table: {
            search: tTable("search"),
            searchPlaceholder: t("searchPlaceholder"),
            empty: tTable("empty"),
            previous: tTable("previous"),
            next: tTable("next"),
            pageStatus: tTable("pageStatus", { page: list.page, pages }),
            sortBy: tTable("sortBy"),
          },
        }}
      />
    </div>
  );
}
