import { notFound } from "next/navigation";
import {
  getFormatter,
  getTranslations,
  setRequestLocale,
} from "next-intl/server";

import { getUserDetail, getUserTimeline } from "@/db/queries/admin/users";
import { requireAdminPermission } from "@/lib/admin/guard";
import { hasPermission } from "@/lib/authz";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { Badge } from "@/components/ui/badge";
import { Timeline } from "./features/timeline";

export const dynamic = "force-dynamic";

/**
 * One person, gathered.
 *
 * The literal answer to "did they take the exam, and what did they score" —
 * plus everything else they have done, read from the activity spine rather
 * than from counters kept on the user row. Counters answer only the questions
 * somebody thought of in advance, and they drift the first time a write path
 * forgets to increment one.
 */
export default async function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale as Locale);

  const actor = await requireAdminPermission("user:read");
  // The timeline is activity data and needs its own grant. Somebody who can
  // see the account list is not automatically owed a record of what that
  // person did and when.
  const canSeeActivity = hasPermission(actor, "activity:read");
  const canSeeExams = hasPermission(actor, "exam:read");

  const user = await getUserDetail(id);
  if (!user) notFound();

  const timeline = canSeeActivity
    ? await getUserTimeline(id, { limit: 25 })
    : { entries: [], nextCursor: null };

  const t = await getTranslations("admin.users");
  const activity = await getTranslations("admin.activity");
  const format = await getFormatter();

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/users"
          className="text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          {t("backToUsers")}
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">{user.name}</h1>
        <p className="text-sm text-muted-foreground">{user.email}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {user.roleKeys.map((key) => (
            <Badge key={key} variant="outline">
              {key}
            </Badge>
          ))}
          {!user.emailVerified && (
            <Badge variant="secondary">{t("unverified")}</Badge>
          )}
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat
          label={t("counts.lessonsViewed")}
          value={user.counts.lessonsViewed}
        />
        <Stat
          label={t("counts.lessonsCompleted")}
          value={user.counts.lessonsCompleted}
        />
        <Stat label={t("counts.comments")} value={user.counts.comments} />
        <Stat label={t("counts.likes")} value={user.counts.likes} />
        <Stat label={t("counts.examsTaken")} value={user.counts.examsTaken} />
        <Stat label={t("counts.examsPassed")} value={user.counts.examsPassed} />
      </dl>

      <dl className="grid gap-3 rounded-lg border p-4 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">
            {t("joined")}
          </dt>
          <dd>{format.dateTime(user.createdAt, { dateStyle: "long" })}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">
            {t("lastSignIn")}
          </dt>
          {/* Named for what it measures. A signed-in tab left open all week
              does not refresh a session row, so calling this "last seen"
              would be a claim the data cannot support. */}
          <dd>
            {user.lastSeenAt
              ? format.dateTime(new Date(user.lastSeenAt), {
                  dateStyle: "long",
                })
              : t("never")}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">
            {t("locale")}
          </dt>
          <dd>{user.locale ?? "—"}</dd>
        </div>
      </dl>

      {canSeeExams && (
        <section className="space-y-2">
          <h2 className="font-semibold">{t("quizzes.heading")}</h2>
          {user.quizzes.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("quizzes.empty")}
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="p-3 text-start font-medium">
                      {t("quizzes.quiz")}
                    </th>
                    <th className="p-3 text-start font-medium">
                      {t("quizzes.attempts")}
                    </th>
                    <th className="p-3 text-start font-medium">
                      {t("quizzes.best")}
                    </th>
                    <th className="p-3 text-start font-medium">
                      {t("quizzes.latest")}
                    </th>
                    <th className="p-3 text-start font-medium">
                      {t("quizzes.passed")}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {user.quizzes.map((result) => (
                    <tr key={result.quizSlug}>
                      <td className="p-3">
                        <Link
                          href={`/admin/exams/${result.quizSlug}`}
                          className="underline-offset-4 hover:underline"
                        >
                          {result.quizTitle}
                        </Link>
                      </td>
                      <td className="p-3 tabular-nums">{result.attempts}</td>
                      {/* Best AND latest, because one number hides either the
                          improvement or the regression. */}
                      <td className="p-3 tabular-nums">
                        {result.bestPercent === null
                          ? "—"
                          : format.number(result.bestPercent / 100, {
                              style: "percent",
                            })}
                      </td>
                      <td className="p-3 tabular-nums">
                        {result.latestPercent === null
                          ? "—"
                          : format.number(result.latestPercent / 100, {
                              style: "percent",
                            })}
                      </td>
                      <td className="p-3">
                        {result.passed ? t("quizzes.yes") : t("quizzes.no")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {canSeeActivity && (
        <section className="space-y-2">
          <h2 className="font-semibold">{t("timeline.heading")}</h2>
          <Timeline
            userId={id}
            initial={timeline.entries.map((entry) => ({
              id: entry.id,
              label: activity(`verbs.${entry.verb}` as never),
              objectType: entry.objectType,
              objectId: entry.objectId,
              // ISO, formatted in the client through next-intl's formatter —
              // the same path the pages loaded later take, so the first page
              // and the rest cannot render differently.
              at: entry.createdAt.toISOString(),
            }))}
            initialCursor={timeline.nextCursor}
            labels={{
              more: t("timeline.more"),
              loading: t("timeline.loading"),
              end: t("timeline.end"),
              empty: t("timeline.empty"),
            }}
          />
        </section>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border p-3">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="text-2xl font-semibold tabular-nums">{value}</dd>
    </div>
  );
}
