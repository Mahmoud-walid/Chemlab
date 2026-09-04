import { setRequestLocale } from "next-intl/server";

import { hasDatabase } from "@/db/queries/availability";
import { getQuizBySlug, listQuizSlugs } from "@/db/queries/quizzes";
import { redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import QuizRunner from "./features/quiz-runner";

// ── Pre-generate every quiz page at build time, when there is a database ──
// Without one the build still succeeds and the pages render on demand; see
// db/queries/availability.ts.
export async function generateStaticParams() {
  if (!hasDatabase()) return [];
  const slugs = await listQuizSlugs();
  return slugs.map((slug) => ({ slug }));
}

export default async function QuizSlugPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  setRequestLocale(locale as Locale);

  const quiz = await getQuizBySlug(slug, locale);
  // An unknown slug sends the visitor back to the catalogue, as it always has
  // — but now on the server, so they never see a blank page first.
  if (!quiz) {
    redirect({ href: "/quiz", locale: locale as Locale });
    // Unreachable — redirect() throws. Present only because next-intl types it
    // as returning void rather than never, so TypeScript cannot narrow `quiz`.
    return null;
  }

  return <QuizRunner quiz={quiz} />;
}
