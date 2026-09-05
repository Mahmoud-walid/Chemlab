import {
  getFormatter,
  getTranslations,
  setRequestLocale,
} from "next-intl/server";

import {
  addDays,
  dailySeries,
  funnelCounts,
  quizAttemptSeries,
  startOfDay,
  topObjects,
} from "@/db/queries/admin/rollup";
import { requireAdminPermission } from "@/lib/admin/guard";
import { visibleNav } from "@/lib/admin/nav";
import { hasPermission } from "@/lib/authz";
import { Link } from "@/i18n/navigation";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { Locale } from "@/i18n/routing";
import {
  DailyAreaChart,
  DailyLineChart,
  QuizAttemptsChart,
} from "./features/activity-charts";

export const dynamic = "force-dynamic";

/**
 * The dashboard.
 *
 * A landing page rather than a redirect to the first section the viewer can
 * open: a redirect makes `/admin` mean something different for every role, so
 * a bookmark or a shared link lands somewhere unpredictable.
 *
 * Its own `requirePermission` even though the layout already checked. The
 * layout is the gate for the tree, but a page that relies on its parent having
 * checked is one refactor away from being unprotected.
 */
export default async function AdminDashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);

  const context = await requireAdminPermission("admin:access");
  const t = await getTranslations("admin");
  const format = await getFormatter();

  // The charts are activity data and need their own grant. Somebody who can
  // open the panel is not automatically owed a view of what everybody did.
  const canSeeActivity = hasPermission(context, "activity:read");

  // Thirty days back, and the range is deliberately fixed for v1: a date
  // picker that nobody has asked for is a control to maintain, and every
  // query here already reads rollups rather than raw events.
  const to = startOfDay(new Date());
  const from = addDays(to, -29);

  const [signups, activity, quizzes, lessons, funnel] = canSeeActivity
    ? await Promise.all([
        dailySeries(["auth.signed_up"], from, to),
        dailySeries(["auth.signed_in"], from, to, "actors"),
        quizAttemptSeries(from),
        topObjects(["lesson.viewed"], "lesson", from, 5),
        funnelCounts(from, addDays(to, 1)),
      ])
    : [[], [], [], [], []];

  // The same filtering the sidebar uses, so the dashboard shows the viewer
  // exactly the sections they can actually open.
  const groups = visibleNav(context.permissions, context.isSuperAdmin).filter(
    (group) => group.labelKey !== "groups.overview",
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          {t("dashboard.title")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("dashboard.subtitle")}
        </p>
      </div>

      {canSeeActivity && (
        <div className="space-y-6">
          <section className="space-y-3 rounded-lg border p-4">
            <h2 className="font-semibold">{t("dashboard.charts.signups")}</h2>
            <DailyAreaChart
              points={signups}
              label={t("dashboard.charts.signupsLabel")}
              summaryLabel={t("dashboard.charts.numbers")}
            />
          </section>

          <section className="space-y-3 rounded-lg border p-4">
            <h2 className="font-semibold">{t("dashboard.charts.active")}</h2>
            {/* Named "sign-ins", not "active users". The rollup's grain is
                (day, verb, object), so summing its unique-actor column across
                rows double-counts somebody who did two things — an honest
                label costs nothing and a wrong one is quoted back later. */}
            <p className="text-xs text-muted-foreground">
              {t("dashboard.charts.activeNote")}
            </p>
            <DailyLineChart
              points={activity}
              label={t("dashboard.charts.activeLabel")}
              summaryLabel={t("dashboard.charts.numbers")}
            />
          </section>

          <section className="space-y-3 rounded-lg border p-4">
            <h2 className="font-semibold">{t("dashboard.charts.quizzes")}</h2>
            <QuizAttemptsChart
              points={quizzes.map((quiz) => ({
                title: quiz.title,
                attempts: quiz.attempts,
                passRate: quiz.passRate,
              }))}
              attemptsLabel={t("dashboard.charts.attempts")}
              passRateLabel={t("dashboard.charts.passRate")}
              summaryLabel={t("dashboard.charts.numbers")}
            />
          </section>

          <section className="space-y-3 rounded-lg border p-4">
            <h2 className="font-semibold">{t("dashboard.funnel.heading")}</h2>
            {/* The caveat belongs on the screen, not only in the code. A
                funnel whose first stage we cannot measure would have an
                invented denominator, so it starts where counting starts. */}
            <p className="text-xs text-muted-foreground">
              {t("dashboard.funnel.caveat")}
            </p>
            <ol className="divide-y rounded-lg border text-sm">
              {funnel.map((stage) => (
                <li
                  key={stage.key}
                  className="flex flex-wrap items-baseline justify-between gap-3 p-3"
                >
                  <span>
                    {t(`dashboard.funnel.stages.${stage.key}` as never)}
                  </span>
                  <span className="flex items-baseline gap-3">
                    {/* A stage nothing emits shows what it is rather than a
                        zero: "0 people read a lesson" is a false claim, and
                        it is the claim somebody quotes back six months on. */}
                    {stage.notYetRecorded ? (
                      <span className="text-xs text-muted-foreground">
                        {t("dashboard.funnel.notRecorded")}
                      </span>
                    ) : (
                      <>
                        <span className="font-semibold tabular-nums">
                          {stage.people}
                        </span>
                        {stage.conversion !== null && (
                          <span className="text-xs text-muted-foreground">
                            {format.number(stage.conversion / 100, {
                              style: "percent",
                            })}{" "}
                            {t("dashboard.funnel.ofPrevious")}
                          </span>
                        )}
                      </>
                    )}
                  </span>
                </li>
              ))}
            </ol>
          </section>

          {lessons.length > 0 && (
            <section className="space-y-3 rounded-lg border p-4">
              <h2 className="font-semibold">
                {t("dashboard.charts.topLessons")}
              </h2>
              <ol className="divide-y rounded-lg border text-sm">
                {lessons.map((lesson) => (
                  <li
                    key={lesson.objectId}
                    className="flex items-baseline justify-between gap-3 p-3"
                  >
                    <Link
                      href={`/admin/lessons/${lesson.objectId}`}
                      className="underline-offset-4 hover:underline"
                    >
                      {lesson.title}
                    </Link>
                    <span className="tabular-nums">{lesson.count}</span>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </div>
      )}

      {groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("dashboard.noSections")}
        </p>
      ) : (
        groups.map((group) => (
          <section key={group.labelKey} className="space-y-3">
            <h2 className="text-sm font-semibold text-muted-foreground">
              {t(group.labelKey)}
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {group.items.map((item) => (
                <Card key={item.segment}>
                  <CardHeader>
                    <CardTitle className="text-base">
                      {t(item.labelKey)}
                    </CardTitle>
                    <CardDescription>{t(item.labelKey)}</CardDescription>
                  </CardHeader>
                </Card>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
