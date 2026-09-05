import {
  getFormatter,
  getTranslations,
  setRequestLocale,
} from "next-intl/server";

import { listAllAttempts } from "@/db/queries/exams/attempts";
import { requireUser } from "@/lib/session";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

/**
 * Every sitting this person has taken.
 *
 * The empty state this replaces said scores would start being kept once the
 * exam engine landed. It has.
 */
export default async function ProfileExamsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);

  const user = await requireUser();
  const attempts = await listAllAttempts(user.id, locale);

  const t = await getTranslations("auth");
  const q = await getTranslations("quiz");
  const format = await getFormatter();

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-10">
      <h1 className="text-2xl font-bold tracking-tight">{t("examsTitle")}</h1>

      {attempts.length === 0 ? (
        <>
          <p className="text-muted-foreground">{t("examsEmpty")}</p>
          <Button asChild variant="outline">
            <Link href="/quiz">{t("browseQuizzes")}</Link>
          </Button>
        </>
      ) : (
        <ul className="divide-y rounded-xl border">
          {attempts.map((attempt) => (
            <li
              key={attempt.id}
              className="flex flex-wrap items-center justify-between gap-3 p-4"
            >
              <div className="min-w-0">
                <Link
                  href={`/quiz/${attempt.quizSlug}`}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  {attempt.quizTitle}
                </Link>
                <p className="text-xs text-muted-foreground">
                  {q("attemptNumber", { number: attempt.attemptNumber })} ·{" "}
                  {format.dateTime(attempt.submittedAt ?? attempt.startedAt, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </p>
              </div>

              <div className="flex items-center gap-3 text-sm">
                {attempt.status === "in_progress" ? (
                  <Link
                    href={`/quiz/${attempt.quizSlug}`}
                    className="underline underline-offset-4"
                  >
                    {q("resume")}
                  </Link>
                ) : (
                  <>
                    <span className="font-semibold">
                      {format.number(attempt.percent / 100, {
                        style: "percent",
                      })}
                    </span>
                    {/* A `never` quiz still shows the score — it is the
                        candidate's own mark. What it withholds is the answers. */}
                    {attempt.reviewPolicy !== "never" && (
                      <Link
                        href={`/quiz/${attempt.quizSlug}/attempts/${attempt.id}`}
                        className="underline underline-offset-4"
                      >
                        {q("review")}
                      </Link>
                    )}
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
