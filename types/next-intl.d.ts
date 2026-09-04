import type en from "@/messages/en.json";
import type { Locale } from "@/i18n/routing";

/**
 * Types the message catalogue from the English source, so `t("nav.lessons")`
 * autocompletes and `t("nav.doesNotExist")` is a typecheck error rather than a
 * blank string discovered in production.
 */
declare module "next-intl" {
  interface AppConfig {
    Messages: typeof en;
    Locale: Locale;
  }
}
