import {
  getFormatter,
  getTranslations,
  setRequestLocale,
} from "next-intl/server";

import {
  LESSON_LIST_SPEC,
  listLessonsForAdmin,
  type LessonSort,
} from "@/db/queries/admin/lessons";
import { parseListParams } from "@/db/queries/admin/list-params";
import type { ContentStatus } from "@/db/schema/content";
import { requireAdminPermission } from "@/lib/admin/guard";
import { hasPermission } from "@/lib/authz";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { LessonsTable } from "./features/lessons-table";
import { StatusFilter } from "@/components/admin/status-filter";
import { translationTargetLocale } from "@/lib/translations/target-locale";
import {
  TRANSLATION_STATES,
  isTranslationState,
  type TranslationState,
} from "@/lib/translations/state";

export const dynamic = "force-dynamic";

const STATUSES = ["draft", "published", "archived"] as const;

/** The `?translation=` value, or undefined for "all". */
function translationFilter(
  raw: string | string[] | undefined,
): TranslationState | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  // Validated against the ladder rather than passed through: an unrecognised
  // value must widen to "all", not reach the query as a rank of NaN and
  // return an empty list that looks like "nothing is missing".
  return isTranslationState(value) ? value : undefined;
}

/** The `?status=` value, or undefined for "all". Anything unknown is "all". */
function statusFilter(raw: string | string[] | undefined) {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return STATUSES.includes(value as ContentStatus)
    ? (value as ContentStatus)
    : undefined;
}

export default async function AdminLessonsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);

  // Its own gate. The layout checked `admin:access`; reading unpublished
  // lessons needs `lesson:read`, and a page that leans on its parent is one
  // refactor away from being unprotected.
  const actor = await requireAdminPermission("lesson:read");
  const canCreate = hasPermission(actor, "lesson:create");

  const raw = await searchParams;
  const list = parseListParams<LessonSort>(raw, LESSON_LIST_SPEC);
  const status = statusFilter(raw.status);

  // The one non-default locale. Undefined only if the site is ever configured
  // with a single language, in which case there is nothing to ask about.
  const translationLocale = translationTargetLocale();
  const translationState = translationFilter(raw.translation);

  const { rows, total, pages } = await listLessonsForAdmin(list, {
    status,
    translationLocale,
    translationState,
  });

  const t = await getTranslations("admin.lessons");
  const tTable = await getTranslations("admin.table");
  const format = await getFormatter();

  const statusNames = {
    draft: t("status.draft"),
    published: t("status.published"),
    archived: t("status.archived"),
  } as const;

  const tXlate = await getTranslations("admin.translations");
  const translationNames = Object.fromEntries(
    TRANSLATION_STATES.map((state) => [state, tXlate(state)]),
  ) as Record<TranslationState, string>;

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
            <Link href="/admin/lessons/new">{t("new")}</Link>
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

      {/* Its own row, captioned. Two unlabelled rows of filter links side by
          side are two rows of words an editor has to guess between — and
          "Draft" would mean the lesson in one and its translation in the
          other. */}
      {translationLocale && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">
            {tXlate("rowLabel")}
          </span>
          <StatusFilter
            param="translation"
            label={tXlate("filter")}
            current={translationState ?? "all"}
            options={[
              { value: "all", label: tXlate("all") },
              ...TRANSLATION_STATES.map((value) => ({
                value,
                label: translationNames[value],
              })),
            ]}
          />
        </div>
      )}

      <LessonsTable
        rows={rows.map((row) => ({
          ...row,
          difficulty: difficultyNames[row.difficulty],
          // Pluralised here rather than in the table: next-intl's plural rules
          // belong to the request's locale, and a formatting FUNCTION cannot
          // cross into a client component — passing one renders the error
          // boundary instead of the list.
          contentLabel:
            row.sectionCount === 0
              ? t("noContent")
              : t("sectionCount", { count: row.sectionCount }),
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
          content: t("columns.content"),
          updated: t("columns.updated"),
          statusNames,
          translation: translationLocale ? tXlate("label") : undefined,
          translationNames: translationLocale ? translationNames : undefined,
          table: {
            search: tTable("search"),
            searchPlaceholder: t("searchPlaceholder"),
            empty: tTable("empty"),
            previous: tTable("previous"),
            next: tTable("next"),
            pageStatus: tTable("pageStatus", { page: list.page, pages }),
            sortBy: tTable("sortBy"),
            columns: tTable("columns"),
            columnsHint: tTable("columnsHint"),
            loading: tTable("loading"),
          },
        }}
      />
    </div>
  );
}
