import React from "react";
import { setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { listLessons } from "@/db/queries/lessons";
import LessonOverviewPage from "./features/lesson-overview";

/**
 * Rendered per request rather than prerendered.
 *
 * The content now comes from Postgres, and `pnpm build` must keep working with
 * no database — CI builds on every pull request and a build that needs a live
 * database is a build that fails when the database is down. Prerendering this
 * page would query at build time; rendering it on demand queries when someone
 * actually asks for it.
 *
 * The detail routes still prerender when a database IS present, via
 * `generateStaticParams` (see db/queries/availability.ts). Revisit this with
 * ISR once the admin panel exists and content changes have a known cadence.
 */
export const dynamic = "force-dynamic";

export default async function LessonsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  // Opts this route into static rendering for the active locale.
  setRequestLocale(locale as Locale);

  const lessons = await listLessons(locale);

  return (
    <div>
      <LessonOverviewPage lessons={lessons} />
    </div>
  );
}
