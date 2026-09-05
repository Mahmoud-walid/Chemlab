import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import {
  getLessonBySlug,
  listLessonSlugs,
  relatedLessons,
} from "@/db/queries/lessons";
import { hasDatabase } from "@/db/queries/availability";
import { BlockRenderer } from "@/components/lessons/block-renderer";
import { EngagementBar } from "@/components/lessons/engagement-bar";
import { ReadingProgress } from "@/components/lessons/reading-progress";
import { TableOfContents } from "@/components/lessons/table-of-contents";
import { ViewBeacon } from "@/components/lessons/view-beacon";
import { CommentSection } from "@/components/comments/comment-section";
import { readingTimeMinutes } from "@/lib/lessons/reading-time";
import { Link } from "@/i18n/navigation";
import { defaultLocale, type Locale } from "@/i18n/routing";

/**
 * One lesson, rendered from the database.
 *
 * This replaces two hand-written routes — `introduction-basics/page.tsx` and
 * the `studying-chemistry` article underneath it — that each rendered one
 * lesson's prose as JSX. A route per lesson does not scale past the two that
 * existed, cannot be edited by anyone without a deploy, and gave the two
 * lessons a different reading experience from each other.
 *
 * Prerendered per locale when a database is present. The page is static, which
 * is why the view event is recorded by a beacon rather than by the page: an
 * `after()` inside a prerendered page runs at BUILD time, so it would count
 * the build, once, instead of counting readers.
 */

export async function generateStaticParams() {
  if (!hasDatabase()) return [];
  const slugs = await listLessonSlugs();
  return slugs.map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  const lesson = await getLessonBySlug(slug, locale);
  if (!lesson) return {};

  return {
    title: lesson.title,
    description: lesson.description,
    openGraph: { title: lesson.title, description: lesson.description },
  };
}

export default async function LessonPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  setRequestLocale(locale as Locale);

  const lesson = await getLessonBySlug(slug, locale);
  // A 404 from the page body, not the layout, is correct here: this route is
  // static, so the status is decided before anything streams.
  if (!lesson) notFound();

  const related = await relatedLessons(slug, locale);
  const t = await getTranslations("lessons");
  const tTranslation = await getTranslations("translation");

  const minutes = readingTimeMinutes(lesson.readingTimeSeconds);
  const toc = lesson.sections.map((section, index) => ({
    id: section.id,
    level: 2 as const,
    text: section.heading,
    anchor: section.anchor,
    number: index + 1,
  }));

  // The body is chemistry source material. When there is no translation for
  // this locale it is served as written rather than machine-translated — an
  // unreviewed translation of chemistry is how a factual error ships — and the
  // notice below says so instead of leaving the reader to wonder.
  const bodyIsTranslated = lesson.isTranslated || locale === defaultLocale;

  return (
    <>
      <ReadingProgress label={t("readingProgress")} />

      <div className="mx-auto w-full max-w-6xl px-4 py-10">
        <Link
          href="/lessons"
          className="text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          {t("backToLessons")}
        </Link>

        <header className="mt-4 max-w-[68ch]">
          <p className="text-xs font-bold uppercase tracking-widest text-primary-text">
            {lesson.category}
          </p>
          <h1 className="mt-2 text-4xl font-bold tracking-tight">
            {lesson.title}
          </h1>
          <p className="mt-3 text-lg text-muted-foreground">
            {lesson.description}
          </p>
          <p className="mt-3 text-sm text-muted-foreground">
            {t("readingTime", { minutes })}
            {" · "}
            {t(`difficulty.${lesson.difficulty}` as never)}
          </p>
        </header>

        {/* Counts are NOT read here. This page is prerendered, so a count
            rendered on the server would be the count at BUILD time — wrong by
            the first like, and wrong in a way that looks authoritative. The
            bar fetches its own state on mount, which also gets the viewer
            their own liked/saved state without making the page dynamic. */}
        <div className="mt-6">
          <EngagementBar
            slug={lesson.slug}
            title={lesson.title}
            labels={{
              like: t("like"),
              liked: t("liked"),
              save: t("save"),
              saved: t("saved"),
              share: t("share"),
              shareCopied: t("shareCopied"),
              shareFailed: t("shareFailed"),
              signInToLike: t("signInToLike"),
              failed: t("engagementFailed"),
            }}
          />
        </div>

        {!bodyIsTranslated && (
          <div
            role="note"
            dir="auto"
            className="mt-6 max-w-[68ch] rounded-lg border bg-secondary px-4 py-3 text-sm"
          >
            <p className="font-semibold text-secondary-foreground">
              {tTranslation("notAvailableTitle")}
            </p>
            <p className="mt-0.5 text-muted-foreground">
              {tTranslation("notAvailableBody")}
            </p>
          </div>
        )}

        <div className="mt-10 gap-10 lg:grid lg:grid-cols-[1fr_16rem]">
          {/* The measure is capped for the prose only. A 68ch column is the
              readable range for long-form text; the chrome around it is not
              prose and does not want the same limit. */}
          <article
            // The English body inside an Arabic page keeps its own direction,
            // or its punctuation and numbers reorder around it.
            dir={bodyIsTranslated ? undefined : "ltr"}
            className="max-w-[68ch] text-[1.0625rem]"
          >
            {lesson.sections.map((section, index) => (
              <section key={section.id}>
                <h2
                  id={section.anchor}
                  className="mt-10 scroll-mt-24 text-2xl font-bold tracking-tight first:mt-0"
                >
                  {section.heading}
                </h2>
                <BlockRenderer blocks={section.body} />
                {index < lesson.sections.length - 1 && (
                  <hr className="mt-10 opacity-50" />
                )}
              </section>
            ))}

            {lesson.sections.length === 0 && (
              <p className="text-muted-foreground">{t("bodyComingSoon")}</p>
            )}

            {lesson.references.length > 0 && (
              <section className="mt-12 border-t pt-6">
                <h2 className="text-lg font-semibold">{t("references")}</h2>
                <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                  {lesson.references.map((reference) => (
                    <li key={reference}>{reference}</li>
                  ))}
                </ul>
              </section>
            )}
          </article>

          <aside className="mt-10 lg:sticky lg:top-24 lg:mt-0 lg:self-start">
            <TableOfContents entries={toc} label={t("contents")} />
          </aside>
        </div>

        {related.length > 0 && (
          <section className="mt-16 border-t pt-8">
            <h2 className="text-lg font-semibold">{t("readNext")}</h2>
            <ul className="mt-4 grid gap-4 sm:grid-cols-3">
              {related.map((item) => (
                <li key={item.slug}>
                  <Link
                    href={`/lessons/${item.slug}`}
                    className="block h-full rounded-xl border p-4 transition-colors hover:border-primary/40"
                  >
                    <p className="text-xs font-bold uppercase tracking-widest text-primary-text">
                      {item.category}
                    </p>
                    <p className="mt-1 font-medium">{item.title}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t(`difficulty.${item.difficulty}` as never)}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
        <section className="mt-12">
          {/* Client-side: this page is prerendered, so who is reading it is
              not known until the browser says so. */}
          <CommentSection subjectId={lesson.id} />
        </section>
      </div>

      <ViewBeacon slug={lesson.slug} />
    </>
  );
}
