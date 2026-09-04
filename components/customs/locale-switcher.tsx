"use client";

import { useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
// `useSearchParams` has no locale-aware counterpart in `@/i18n/navigation`:
// query strings are locale-independent, so the plain Next.js hook is the right
// one (and the ESLint guard allows it). Everything that *is* locale-aware —
// pathname and router — comes from the navigation module below.
import { useSearchParams } from "next/navigation";
import { CheckIcon, LanguagesIcon } from "lucide-react";

import { usePathname, useRouter } from "@/i18n/navigation";
import { locales, type Locale } from "@/i18n/routing";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** Each language is shown in its own script so a reader who cannot read the
 * current UI language can still recognise their own. */
const localeDirection: Record<Locale, "ltr" | "rtl"> = {
  en: "ltr",
  ar: "rtl",
};

export function LocaleSwitcher() {
  const t = useTranslations("locale");
  const active = useLocale() as Locale;
  const router = useRouter();
  // next-intl's `usePathname` returns the path with the locale prefix stripped,
  // so it can be re-rendered under any locale.
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  function selectLocale(next: Locale) {
    if (next === active) return;

    // Carry the query string across the switch — losing it (or the path) drops
    // the reader out of whatever they were doing. `getAll` keeps repeated keys.
    const query: Record<string, string | string[]> = {};
    for (const key of new Set(searchParams.keys())) {
      const values = searchParams.getAll(key);
      query[key] = values.length > 1 ? values : values[0];
    }

    startTransition(() => {
      // `replace` (not `push`) so the back button does not bounce the reader
      // into the previous language. next-intl writes the NEXT_LOCALE cookie.
      router.replace({ pathname, query }, { locale: next });
    });

    // TODO(#profile): persist the chosen locale to the signed-in user's
    // profile here once the profile-preferences issue lands. This component
    // stays presentational until then.
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          aria-label={t("switchLabel")}
          disabled={isPending}
        >
          <LanguagesIcon aria-hidden />
          <span lang={active} dir={localeDirection[active]}>
            {t(active)}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40">
        {locales.map((locale) => {
          const isActive = locale === active;

          return (
            <DropdownMenuItem
              key={locale}
              onSelect={() => selectLocale(locale)}
              aria-current={isActive ? "true" : undefined}
              lang={locale}
              dir={localeDirection[locale]}
              className="justify-between gap-3"
            >
              <span>{t(locale)}</span>
              {isActive ? (
                <CheckIcon className="size-4 shrink-0" aria-hidden />
              ) : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default LocaleSwitcher;
