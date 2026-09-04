import { getRequestConfig } from "next-intl/server";
import { resolveLocale } from "@/i18n/routing";

export default getRequestConfig(async ({ requestLocale }) => {
  // Resolution order today: URL segment -> NEXT_LOCALE cookie / Accept-Language
  // (both handled by the middleware) -> default. When user profiles land, the
  // signed-in user's `locale` column is consulted inside resolveLocale, and
  // this function does not change.
  const locale = resolveLocale(await requestLocale);

  return {
    locale,
    messages: (await import(`@/messages/${locale}.json`)).default,
    // Pinned so server and client render identical dates; without it Next
    // warns and hydration can mismatch across time zones.
    timeZone: "UTC",
  };
});
