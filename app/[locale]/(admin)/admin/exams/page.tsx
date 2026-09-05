import {
  getFormatter,
  getTranslations,
  setRequestLocale,
} from "next-intl/server";

import { listQuizAttemptSummaries } from "@/db/queries/admin/attempts";
import { requireAdminPermission } from "@/lib/admin/guard";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

/**
 * Sittings, per quiz.
 *
 * Guarded by `exam:read`, which in this vocabulary means exactly this: view
 * attempts and scores. It is deliberately not `quiz:read` — an Editor who
 * writes the questions has no reason to see who scored what.
 */
export default async function AdminExamsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);

  await requireAdminPermission("exam:read");

  const summaries = await listQuizAttemptSummaries();
  const t = await getTranslations("admin.exams");
  const format = await getFormatter();

  const totalFinished = summaries.reduce((sum, row) => sum + row.finished, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      {totalFinished === 0 ? (
        <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          {t("empty")}
        </p>
      ) : null}

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-start">
            <tr>
              <th className="p-3 font-medium">{t("columns.quiz")}</th>
              <th className="p-3 font-medium">{t("columns.finished")}</th>
              <th className="p-3 font-medium">{t("columns.inProgress")}</th>
              <th className="p-3 font-medium">{t("columns.voided")}</th>
              <th className="p-3 font-medium">{t("columns.average")}</th>
              <th className="p-3 font-medium">{t("columns.passRate")}</th>
              <th className="p-3 font-medium">{t("columns.lastAttempt")}</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {summaries.map((row) => (
              <tr key={row.slug} className="hover:bg-muted/30">
                <td className="p-3">
                  <Link
                    href={`/admin/exams/${row.slug}`}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {row.title}
                  </Link>
                  {row.status !== "published" && (
                    <Badge variant="outline" className="ms-2 align-middle">
                      {t(`statuses.${row.status}` as never)}
                    </Badge>
                  )}
                </td>
                <td className="p-3 tabular-nums">{row.finished}</td>
                <td className="p-3 tabular-nums">{row.inProgress}</td>
                {/* Voided sittings get their own column rather than being
                    folded into the count: hiding them would make this table
                    disagree with the list on the next screen. */}
                <td className="p-3 tabular-nums">{row.voided}</td>
                <td className="p-3 tabular-nums">
                  {row.averagePercent === null
                    ? "—"
                    : format.number(row.averagePercent / 100, {
                        style: "percent",
                      })}
                </td>
                <td className="p-3 tabular-nums">
                  {row.passRate === null
                    ? "—"
                    : format.number(row.passRate / 100, { style: "percent" })}
                </td>
                <td className="p-3 text-muted-foreground">
                  {row.lastAttemptAt
                    ? format.dateTime(new Date(row.lastAttemptAt), {
                        dateStyle: "medium",
                      })
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
