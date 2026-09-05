import { notFound } from "next/navigation";
import {
  getFormatter,
  getTranslations,
  setRequestLocale,
} from "next-intl/server";

import {
  ATTEMPT_LIST_SPEC,
  getQuizAttemptDetail,
  type AttemptSort,
} from "@/db/queries/admin/attempts";
import { parseListParams } from "@/db/queries/admin/list-params";
import { requireAdminPermission } from "@/lib/admin/guard";
import { hasPermission } from "@/lib/authz";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { Badge } from "@/components/ui/badge";
import { ExportButton } from "@/components/admin/export-button";
import { ScoreDistribution } from "./features/score-distribution";
import { AttemptsTable } from "./features/attempts-table";

export const dynamic = "force-dynamic";

export default async function AdminExamDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, slug } = await params;
  setRequestLocale(locale as Locale);

  const actor = await requireAdminPermission("exam:read");
  // Voiding is its own grant: reading the scores and striking one out are
  // different levels of trust. The table renders read-only without it.
  const canVoid = hasPermission(actor, "exam:void");
  // A file of marks with candidate names in it is a different act from reading
  // them on screen, and `exam:export` is the grant for it.
  const canExport = hasPermission(actor, "exam:export");

  const list = parseListParams<AttemptSort>(
    await searchParams,
    ATTEMPT_LIST_SPEC,
  );
  const detail = await getQuizAttemptDetail(slug, list);
  if (!detail) notFound();

  const t = await getTranslations("admin.exams");
  const format = await getFormatter();

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/exams"
          className="text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          {t("backToExams")}
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">
          {detail.title}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t("attemptTotal", { count: detail.total })}
        </p>
        {canExport && (
          <div className="mt-3">
            <ExportButton
              dataset="attempts"
              label={t("export")}
              hint={t("exportHint")}
              params={{ quiz: detail.slug }}
            />
          </div>
        )}
      </div>

      <section className="space-y-3 rounded-lg border p-4">
        <h2 className="font-semibold">{t("distribution.heading")}</h2>
        <ScoreDistribution
          buckets={detail.distribution}
          labels={{
            attempts: t("distribution.attempts"),
            band: t("distribution.band"),
            empty: t("distribution.empty"),
            summary: t("distribution.summary"),
          }}
        />
      </section>

      <section className="space-y-3 rounded-lg border p-4">
        <h2 className="font-semibold">{t("questions.heading")}</h2>
        <p className="text-sm text-muted-foreground">{t("questions.note")}</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-start">
              <tr>
                <th className="p-2 font-medium">{t("questions.prompt")}</th>
                <th className="p-2 font-medium">{t("questions.answered")}</th>
                <th className="p-2 font-medium">{t("questions.correct")}</th>
                <th className="p-2 font-medium">{t("questions.skipped")}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {detail.questions.map((question) => {
                // Built outside the JSX: the lint rule bans bare strings and
                // template literals in markup, and a numbered prefix is text.
                const numbered = `${question.position + 1}. ${question.prompt}`;
                return (
                  <tr key={question.id}>
                    <td className="max-w-md p-2">{numbered}</td>
                    <td className="p-2 tabular-nums">{question.answered}</td>
                    <td className="p-2 tabular-nums">
                      {question.percentCorrect === null ? (
                        "—"
                      ) : (
                        <span className="flex items-center gap-2">
                          {format.number(question.percentCorrect / 100, {
                            style: "percent",
                          })}
                          {/* Flagged, not hidden: a question almost nobody gets
                            right is either badly worded or teaching something
                            the lesson never covered, and both are worth a look. */}
                          {question.percentCorrect < 30 && (
                            <Badge variant="outline">
                              {t("questions.hard")}
                            </Badge>
                          )}
                        </span>
                      )}
                    </td>
                    <td className="p-2 tabular-nums">{question.skipped}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">{t("attempts.heading")}</h2>
        <AttemptsTable
          quizSlug={slug}
          canVoid={canVoid}
          attempts={detail.attempts.map((attempt) => ({
            ...attempt,
            startedAtLabel: format.dateTime(attempt.startedAt, {
              dateStyle: "medium",
              timeStyle: "short",
            }),
            percentLabel: format.number(attempt.percent / 100, {
              style: "percent",
            }),
          }))}
          labels={{
            candidate: t("attempts.candidate"),
            attemptNumber: t("attempts.attemptNumber"),
            score: t("attempts.score"),
            status: t("attempts.status"),
            started: t("attempts.started"),
            void: t("attempts.void"),
            voiding: t("attempts.voiding"),
            reasonLabel: t("attempts.reasonLabel"),
            reasonPlaceholder: t("attempts.reasonPlaceholder"),
            confirm: t("attempts.confirm"),
            cancel: t("attempts.cancel"),
            deletedUser: t("attempts.deletedUser"),
            empty: t("attempts.empty"),
            statuses: {
              submitted: t("statuses.submitted"),
              expired: t("statuses.expired"),
              in_progress: t("statuses.in_progress"),
              abandoned: t("statuses.abandoned"),
              voided: t("statuses.voided"),
            },
          }}
        />
      </section>
    </div>
  );
}
