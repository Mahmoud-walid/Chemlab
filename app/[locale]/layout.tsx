import "@/configs/setup-console";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import {
  Geist,
  Geist_Mono,
  Inter,
  Cairo,
  Noto_Naskh_Arabic,
} from "next/font/google";
import "../globals.css";
import { Providers } from "@/providers/providers";
import { FloatingNavBar } from "@/components/customs/floating-nav-bar";
import { absoluteUrl, env } from "@/lib/env";
import { direction, locales, routing, type Locale } from "@/i18n/routing";

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
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "common" });

  const siteName = env.NEXT_PUBLIC_SITE_NAME;
  const title = `${siteName} – ${t("tagline")}`;
  const description = env.NEXT_PUBLIC_SITE_DESCRIPTION;
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
        { url: ogImage, width: 1200, height: 630, alt: `${siteName} - ${t("tagline")}` },
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
  if (!hasLocale(routing.locales, locale)) notFound();

  // Opts every route in this segment into static rendering.
  setRequestLocale(locale);

  const t = await getTranslations("common");
  const dir = direction(locale);
  const isArabic = (locale as Locale) === "ar";
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
        <NextIntlClientProvider>
          <Providers>
            {/* pb-24 keeps content clear of the floating nav bar */}
            <main className="pb-24">
              {children}
              <footer className="py-4 text-center text-sm text-gray-500">
                {t("madeWith")}
              </footer>
            </main>

            <FloatingNavBar />
          </Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
