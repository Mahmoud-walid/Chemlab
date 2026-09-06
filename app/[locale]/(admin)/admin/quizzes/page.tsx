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
import { translationTargetLocale } from "@/lib/translations/target-locale";
import {
  TRANSLATION_STATES,
  isTranslationState,
  type TranslationState,
} from "@/lib/translations/state";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { QuizzesTable } from "./features/quizzes-table";

export const dynamic = "force-dynamic";

const STATUSES = ["draft", "published", "archived"] as const;

/** The `?status=` value, or undefined for "all". Anything unknown is "all". */
/** The `?translation=` value, or undefined for "all". */
function translationFilter(
  raw: string | string[] | undefined,
): TranslationState | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  // Validated rather than passed through: an unrecognised value must widen to
  // "all", not reach the query as a rank of NaN and return an empty list that
  // reads as "nothing is missing".
  return isTranslationState(value) ? value : undefined;
}

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
  // Which bulk actions to offer. Checked again in the action — this only
  // decides whether to draw a button somebody cannot use.
  const canBulk = {
    publish: hasPermission(actor, "quiz:publish"),
    withdraw: hasPermission(actor, "quiz:delete"),
  };

  const raw = await searchParams;
  const list = parseListParams<QuizSort>(raw, QUIZ_LIST_SPEC);
  const status = statusFilter(raw.status);

  const translationLocale = translationTargetLocale();
  const translationState = translationFilter(raw.translation);

  const { rows, total, pages } = await listQuizzesForAdmin(list, {
    status,
    translationLocale,
    translationState,
  });

  const t = await getTranslations("admin.quizzes");
  const tTable = await getTranslations("admin.table");
  const format = await getFormatter();

  const statusNames = {
    draft: t("status.draft"),
    published: t("status.published"),
    archived: t("status.archived"),
  } as const;

  const tXlate = await getTranslations("admin.translations");
  const tBulk = await getTranslations("admin.bulk");
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

      <QuizzesTable
        can={canBulk}
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
          bulk: {
            selected: tBulk.raw("selected") as string,
            offPage: tBulk.raw("offPage") as string,
            clear: tBulk("clear"),
            confirmTitle: tBulk.raw("confirmTitle") as string,
            confirmBody: tBulk.raw("confirmBody") as string,
            confirmCountLabel: tBulk("confirmCountLabel"),
            apply: tBulk("apply"),
            cancel: tBulk("cancel"),
            refusedTitle: tBulk("refusedTitle"),
            refusedBody: tBulk("refusedBody"),
            refusedMissing: tBulk("refusedMissing"),
            // The server sends `QuizPublishBlocker` KEYS, so a bulk refusal
            // and a single refusal read identically and neither hard-codes
            // English. `noQuestions` and `unanswerableQuestion` are the two
            // the lesson table has no equivalent of.
            blockerNames: {
              deleted: t("blockers.deleted"),
              missingTitle: t("blockers.missingTitle"),
              missingDescription: t("blockers.missingDescription"),
              missingCategory: t("blockers.missingCategory"),
              noQuestions: t("blockers.noQuestions"),
              unanswerableQuestion: t("blockers.unanswerableQuestion"),
            },
            publish: tBulk("publish"),
            archive: tBulk("archive"),
            withdraw: tBulk("withdraw"),
            applied: tBulk.raw("applied") as string,
            unchanged: tBulk.raw("unchanged") as string,
          },
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
            selectRow: tBulk("selectRow"),
            selectAllOnPage: tBulk("selectAllOnPage"),
            columns: tTable("columns"),
            columnsHint: tTable("columnsHint"),
            loading: tTable("loading"),
          },
        }}
      />
    </div>
  );
}
