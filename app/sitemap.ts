import type { MetadataRoute } from "next";
import { routing } from "@/i18n/routing";
import { getPathname } from "@/i18n/navigation";
import { absoluteUrl } from "@/lib/env";
import elements from "@/data/periodic-table-detailed.json";
import lessons from "@/data/lessons.json";
import quizzes from "@/data/quiz.json";

/** Routes that exist in every locale. Dynamic ones are expanded below. */
const STATIC_ROUTES = ["/", "/lessons", "/quiz", "/quiz/results"] as const;

function slugify(name: string): string {
  return name.toLowerCase().replace(/\s+/g, "-");
}

/**
 * One entry per route per locale, each listing the other locales as
 * alternates. Search engines index URLs, not cookies — without both variants
 * here, the Arabic pages are effectively invisible.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const paths = [
    ...STATIC_ROUTES,
    ...(elements as { name: string }[]).map(
      (e) => `/chemical/${slugify(e.name)}`,
    ),
    ...(lessons as { slug: string }[]).map((l) => `/lessons/${l.slug}`),
    ...(quizzes as { slug: string }[]).map((q) => `/quiz/${q.slug}`),
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
