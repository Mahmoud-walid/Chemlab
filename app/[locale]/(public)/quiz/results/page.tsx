import { permanentRedirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";

/**
 * The old session-only results screen.
 *
 * It read `sessionStorage`, so a result vanished when the tab closed and
 * could be edited by whoever held the tab. Attempts are database rows now,
 * and the history that replaces this lives with the account at
 * `/profile/exams`.
 *
 * A permanent redirect rather than a deletion: this URL has been linked from
 * the quiz screens since the site launched, and a 404 for somebody's
 * bookmarked results page is a worse answer than their actual results.
 *
 * Deliberately NOT migrating what is in `sessionStorage` into the database.
 * Those scores were computed in the browser from an answer key the browser
 * also held — writing them in as real results would launder unverifiable
 * numbers into a permanent record.
 */
export default async function QuizResultsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  // next-intl's helper rather than Next's: the default locale is served
  // unprefixed, so a hand-built `/${locale}/…` would emit `/en/profile/exams`
  // and cost the visitor a second redirect to strip it again.
  permanentRedirect({ href: "/profile/exams", locale: locale as Locale });
}
