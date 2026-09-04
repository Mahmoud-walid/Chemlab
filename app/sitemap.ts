import type { MetadataRoute } from "next";
import { routing } from "@/i18n/routing";
import { getPathname } from "@/i18n/navigation";
import { absoluteUrl } from "@/lib/env";
import { hasDatabase } from "@/db/queries/availability";
import { listElementSlugs } from "@/db/queries/elements";
import { listLessonSlugs } from "@/db/queries/lessons";
import { listQuizSlugs } from "@/db/queries/quizzes";

/** Routes that exist in every locale. Dynamic ones are expanded below. */
const STATIC_ROUTES = ["/", "/lessons", "/quiz", "/quiz/results"] as const;

/**
 * One entry per route per locale, each listing the other locales as
 * alternates. Search engines index URLs, not cookies — without both variants
 * here, the Arabic pages are effectively invisible.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // With no database the sitemap lists the routes that exist without one,
  // rather than failing the build. The content routes reappear the moment a
  // database is configured — see db/queries/availability.ts.
  const [elementSlugs, lessonSlugs, quizSlugs] = hasDatabase()
    ? await Promise.all([
        listElementSlugs(),
        listLessonSlugs(),
        listQuizSlugs(),
      ])
    : [[], [], []];

  const paths = [
    ...STATIC_ROUTES,
    ...elementSlugs.map((slug) => `/chemical/${slug}`),
    ...lessonSlugs.map((slug) => `/lessons/${slug}`),
    ...quizSlugs.map((slug) => `/quiz/${slug}`),
  ];

  return paths.map((path) => ({
    url: absoluteUrl(localePath(path, routing.defaultLocale)),
    alternates: {
      languages: Object.fromEntries(
        routing.locales.map((locale) => [
          locale,
          absoluteUrl(localePath(path, locale)),
        ]),
      ),
    },
  }));
}

function localePath(path: string, locale: (typeof routing.locales)[number]) {
  // getPathname applies the "as-needed" prefix: "/lessons" for English,
  // "/ar/lessons" for Arabic.
  return getPathname({ href: path, locale });
}
