import React from "react";
import { setRequestLocale } from "next-intl/server";
import LessonOverviewPage from "./features/lesson-overview";

export default async function LessonsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  // Opts this route into static rendering for the active locale.
  setRequestLocale(locale);

  return (
    <div>
      <LessonOverviewPage />
    </div>
  );
}
