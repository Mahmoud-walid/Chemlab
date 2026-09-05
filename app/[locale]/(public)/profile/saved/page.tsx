import {
  getFormatter,
  getTranslations,
  setRequestLocale,
} from "next-intl/server";

import { listSavedLessons } from "@/db/queries/lessons-engagement";
import { requireUser } from "@/lib/session";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

/**
 * A reader's saved lessons.
 *
 * Private, and private by construction: the user id comes from the session,
 * never from the request, so there is no id to tamper with and no "whose list
 * is this" question to get wrong. There is no route that shows anybody else's.
 */
export default async function ProfileSavedPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);

  const user = await requireUser();
  const saved = await listSavedLessons(user.id);

  const t = await getTranslations("auth");
  const tLessons = await getTranslations("lessons");
  const format = await getFormatter();

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-10">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("savedTitle")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {tLessons("lessonCount", { count: saved.length })}
        </p>
      </div>

      {saved.length === 0 ? (
        <div className="space-y-4">
          <p className="text-muted-foreground">{t("savedEmpty")}</p>
          <Button asChild variant="outline">
            <Link href="/lessons">{t("browseLessons")}</Link>
          </Button>
        </div>
      ) : (
        <ul className="space-y-3">
          {saved.map((lesson) => (
            <li key={lesson.slug}>
              <Link
                href={`/lessons/${lesson.slug}`}
                className="block rounded-xl border p-4 transition-colors hover:border-primary/40"
              >
                <p className="text-xs font-bold uppercase tracking-widest text-primary-text">
                  {lesson.category}
                </p>
                <p className="mt-1 font-medium">{lesson.title}</p>
                <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                  {lesson.description}
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  {format.dateTime(lesson.savedAt, { dateStyle: "medium" })}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
