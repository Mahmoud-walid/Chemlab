import React from "react";
import { setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import Content from "./features/content";

export default async function IntroductionBasics({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  // Opts this route into static rendering for the active locale.
  setRequestLocale(locale as Locale);

  return (
    <div>
      <Content />
    </div>
  );
}
