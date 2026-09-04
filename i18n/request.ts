import { getRequestConfig } from "next-intl/server";
import { hasLocale } from "next-intl";
import { routing, type Locale } from "@/i18n/routing";

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;

  // Resolution order today: URL segment -> NEXT_LOCALE cookie / Accept-Language
  // (both handled by the middleware) -> default. When user profiles land, the
  // signed-in user's `locale` column is consulted before the cookie, and that
  // is the only change this function needs.
  const locale: Locale = hasLocale(routing.locales, requested)
    ? requested
    : routing.defaultLocale;

  return {
    locale,
    messages: (await import(`@/messages/${locale}.json`)).default,
    // Pinned so server and client render identical dates; without it Next
    // warns and hydration can mismatch across time zones.
    timeZone: "UTC",
  };
});
