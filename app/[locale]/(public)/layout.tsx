import { getTranslations, setRequestLocale } from "next-intl/server";

import { AccountMenu } from "@/components/customs/account-menu";
import { FloatingNavBar } from "@/components/customs/floating-nav-bar";
import type { Locale } from "@/i18n/routing";

/**
 * The public site's chrome.
 *
 * A route group, so every page under it keeps its URL — `/lessons`, not
 * `/(public)/lessons`. It exists so the admin panel can have entirely
 * different chrome rather than the same chrome with pieces hidden: an admin
 * page is not a public page with the nav bar switched off.
 */
export default async function PublicLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}>) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);

  const t = await getTranslations("common");

  return (
    <>
      {/* The account surface. A header slot rather than a sixth entry in the
          floating nav bar: the nav bar is for places, this is for who you are,
          and mixing them makes both harder to scan. */}
      <div className="flex justify-end px-4 pt-4">
        <AccountMenu />
      </div>

      {/* pb-24 keeps content clear of the floating nav bar */}
      <main className="pb-24">
        {children}
        <footer className="py-4 text-center text-sm text-muted-foreground">
          {t("madeWith")}
        </footer>
      </main>

      <FloatingNavBar />
    </>
  );
}
