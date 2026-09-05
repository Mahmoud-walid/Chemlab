import "@/configs/setup-console";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import {
  getMessages,
  getTranslations,
  setRequestLocale,
} from "next-intl/server";
import {
  Geist,
  Geist_Mono,
  Inter,
  Cairo,
  Noto_Naskh_Arabic,
} from "next/font/google";
import "../globals.css";
import { Providers } from "@/providers/providers";
import { Toaster } from "@/components/ui/sonner";
import { PushRegistrar } from "@/components/customs/push-registrar";
import { PresenceHeartbeat } from "@/components/presence/presence-heartbeat";
import { absoluteUrl, env } from "@/lib/env";
import { direction, locales, routing, type Locale } from "@/i18n/routing";
import { getSettings } from "@/lib/settings/get";

// Latin faces. The previous twelve-family stack cost twelve font requests for
// one runtime variable; these three cover sans, mono and body text.
const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});
const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });

// Arabic faces. Loaded only on the Arabic locale (see `fontVariables` below),
// so English pages never request them.
const cairo = Cairo({ variable: "--font-arabic-sans", subsets: ["arabic"] });
const notoNaskh = Noto_Naskh_Arabic({
  variable: "--font-arabic-serif",
  subsets: ["arabic"],
});

const latinVariables = [geistSans, geistMono, inter]
  .map((f) => f.variable)
  .join(" ");
const arabicVariables = [cairo, notoNaskh].map((f) => f.variable).join(" ");

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "common" });

  // The database first, the environment as the boot-time fallback. Renaming
  // the site is a settings change, not a redeploy — and an unconfigured or
  // database-less deployment still renders a name rather than an empty title.
  const configured = await getSettings();
  const siteName =
    (configured["general.siteName"]?.value as string | undefined) ??
    env.NEXT_PUBLIC_SITE_NAME;
  const title = `${siteName} – ${t("tagline")}`;
  const description =
    (configured["general.siteDescription"]?.value as string | undefined) ??
    env.NEXT_PUBLIC_SITE_DESCRIPTION;
  const ogImage = absoluteUrl("/og-image.png");
  const path = locale === routing.defaultLocale ? "/" : `/${locale}`;

  return {
    title,
    description,
    keywords: [
      "chemistry",
      "learning",
      "kids",
      "interactive",
      "periodic table",
      "molecules",
      "atoms",
      "science",
      "educational app",
    ],
    creator: `${siteName} Team`,
    publisher: siteName,
    metadataBase: new URL(env.NEXT_PUBLIC_SITE_URL),
    alternates: {
      canonical: path,
      languages: {
        en: "/",
        ar: "/ar",
        "x-default": "/",
      },
    },
    openGraph: {
      title,
      description,
      url: absoluteUrl(path),
      siteName,
      locale: locale === "ar" ? "ar_EG" : "en_US",
      type: "website",
      images: [
        {
          url: ogImage,
          width: 1200,
          height: 630,
          alt: `${siteName} - ${t("tagline")}`,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      ...(env.NEXT_PUBLIC_TWITTER_HANDLE
        ? { site: env.NEXT_PUBLIC_TWITTER_HANDLE }
        : {}),
      images: [ogImage],
    },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        "max-video-preview": -1,
        "max-image-preview": "large",
        "max-snippet": -1,
      },
    },
  };
}

export default async function LocaleLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}>) {
  const { locale } = await params;
  // Narrows `string` to `Locale`, and 404s on /fr rather than rendering an
  // English page under a French URL.
  if (!hasLocale(routing.locales, locale)) notFound();

  // Opts every route in this segment into static rendering.
  setRequestLocale(locale);

  // `admin` and `pages` are withheld from the client bundle: every consumer of
  // both is a server component using `getTranslations`, so serialising them
  // would put an admin catalogue and seven maintenance messages into the
  // payload of every public page for nobody to read. The admin layout puts
  // `admin` back for its own subtree.
  const {
    admin: _admin,
    pages: _pages,
    ...publicMessages
  } = await getMessages();

  const dir = direction(locale);
  const isArabic = locale === "ar";
  const fontVariables = isArabic
    ? `${latinVariables} ${arabicVariables}`
    : latinVariables;
  const defaultFont = isArabic
    ? "var(--font-arabic-sans)"
    : "var(--font-geist-sans)";

  return (
    <html lang={locale} dir={dir} suppressHydrationWarning>
      <body
        className={`${fontVariables} antialiased`}
        style={{ fontFamily: `var(--active-font, ${defaultFont})` }}
      >
        {/* The admin namespace is withheld from the public bundle.
            NextIntlClientProvider serialises whatever it is given into every
            response, so passing the whole catalogue shipped every admin label
            — "Roles and permissions", "Activity" — to every visitor, including
            in the 404 an unauthorised viewer receives. The admin layout
            provides them again for its own subtree. */}
        <NextIntlClientProvider messages={publicMessages}>
          {/* Only what EVERY route needs: the providers, the theme and the
              toaster. Public-site chrome lives in (public)/layout.tsx and the
              admin chrome in (admin)/admin/layout.tsx, so an admin page is not
              a public page with the nav bar hidden by CSS. */}
          <Providers>
            {children}
            <Toaster />
            {/* Registers the service worker and keeps it from going stale. It
                requests no permission — a prompt on first paint is the most
                reliable way to be refused for ever. */}
            <PushRegistrar />
            {/* One fetch a minute from one tab, and only while it is visible.
                See lib/presence/constants.ts for why the numbers are what
                they are. */}
            <PresenceHeartbeat />
          </Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
