import { getTranslations, setRequestLocale } from "next-intl/server";

import { loadPaper } from "../actions";
import { redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { AttemptRunner } from "./features/attempt-runner";

/** A sitting is never cached and never prerendered. */
export const dynamic = "force-dynamic";

export default async function AttemptPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<{ id?: string }>;
}) {
  const { locale, slug } = await params;
  setRequestLocale(locale as Locale);

  const { id } = await searchParams;
  // `loadPaper` calls `requireUser`, which redirects an anonymous visitor to
  // sign in and back — so there is no anonymous branch to write here.
  const paper = id ? await loadPaper(id) : null;

  if (!paper) {
    redirect({ href: `/quiz/${slug}`, locale: locale as Locale });
    return null;
  }

  // A finished attempt is not a sitting. Sending it to its own review is more
  // useful than an error, and it is what a back button lands on.
  if (paper.status !== "in_progress") {
    redirect({
      href: `/quiz/${slug}/attempts/${paper.attemptId}`,
      locale: locale as Locale,
    });
    return null;
  }

  const t = await getTranslations("quiz");

  return (
    <AttemptRunner
      paper={{
        ...paper,
        startedAt: paper.startedAt.toISOString(),
        expiresAt: paper.expiresAt?.toISOString() ?? null,
        serverNow: paper.serverNow.toISOString(),
      }}
      slug={slug}
      labels={{
        submit: t("submit"),
        submitting: t("submitting"),
        next: t("nextQuestion"),
        previous: t("previousQuestion"),
        // A static name. The live count is in the visible text below the bar:
        // a name interpolated on the server would go stale the moment the
        // candidate answered anything.
        answeredProgress: t("answeredProgress"),
        // `{current}` and `{answered}` are left as placeholders and filled in
        // the client component, where the values actually change.
        position: t("questionPosition", {
          current: "{current}",
          total: paper.questions.length,
        }),
        answered: t("answeredCount", { answered: "{answered}" }),
        unanswered: t("unansweredWarning"),
        timeRemaining: t("timeRemaining"),
        untimed: t("rules.untimed"),
        timeUp: t("timeUp"),
        saveFailed: t("saveFailed"),
        expired: t("attemptExpired"),
        confirmSubmit: t("confirmSubmit"),
      }}
    />
  );
}
