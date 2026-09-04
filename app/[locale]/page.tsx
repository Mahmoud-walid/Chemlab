import { setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import HomePageSection from "./features/home-page";

export default async function Home({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  // Keeps this route statically rendered per locale.
  setRequestLocale(locale);

  return <HomePageSection />;
}
