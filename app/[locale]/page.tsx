import { setRequestLocale } from "next-intl/server";
import HomePageSection from "./features/home-page";

export default async function Home({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  // Keeps this route statically rendered per locale.
  setRequestLocale(locale);

  return <HomePageSection />;
}
