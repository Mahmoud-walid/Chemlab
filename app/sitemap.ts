import type { MetadataRoute } from "next";
import { routing } from "@/i18n/routing";
import { getPathname } from "@/i18n/navigation";
import { absoluteUrl } from "@/lib/env";
import { hasDatabase } from "@/db/queries/availability";
import { listElementSlugs } from "@/db/queries/elements";
import { listLessonSlugs } from "@/db/queries/lessons";
import { listQuizSlugs } from "@/db/queries/quizzes";
import { getPageStates } from "@/db/queries/pages";
import { routeKeyFor } from "@/lib/pages/routes";

/**
 * Rendered on demand, not at build time.
 *
 * A sitemap baked at build would list pages an operator closed afterwards —
 * the switch is supposed to work without a deploy, and a statically generated
 * sitemap is a deploy-shaped hole in it. Crawlers fetch this rarely, so the
 * cost of building it per request is negligible; the same reasoning already
 * applies to the three list pages.
 */
export const dynamic = "force-dynamic";

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

  // A closed page must not be advertised to crawlers: the sitemap would keep
  // offering a URL that answers with a maintenance page, which is how a
  // temporary closure turns into a lasting drop in the index. Resolved through
  // the same longest-match rule the proxy uses, so the two cannot disagree.
  const states = await getPageStates();
  const isOpen = (path: string) => {
    if (states.size === 0) return true;
    const key = routeKeyFor(path, [...states.keys()]);
    return key === null || (states.get(key)?.isEnabled ?? true);
  };

  return paths.filter(isOpen).map((path) => ({
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
