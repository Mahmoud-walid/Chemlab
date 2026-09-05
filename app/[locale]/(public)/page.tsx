import { setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { listElements } from "@/db/queries/elements";
import HomePageSection from "./features/home-page";

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

export default async function Home({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  // Keeps this route statically rendered per locale.
  setRequestLocale(locale);

  // Fetched here rather than in the client component: the periodic table is
  // 119 rows of static reference data, so shipping it as part of the server
  // render costs one query and saves every visitor a round trip.
  const elements = await listElements();

  return <HomePageSection elements={elements} />;
}
