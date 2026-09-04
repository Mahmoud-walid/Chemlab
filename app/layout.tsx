import "@/configs/setup-console";
import type { Metadata } from "next";
import { absoluteUrl, env } from "@/lib/env";
import {
  Geist,
  Geist_Mono,
  Inter,
  Roboto,
  Bebas_Neue,
  Kode_Mono,
  Poppins,
  Montserrat,
  Open_Sans,
  Lato,
  Raleway,
  Playfair_Display,
} from "next/font/google";
import "./globals.css";
import { Providers } from "@/providers/providers";
import { FloatingNavBar } from "@/components/customs/floating-nav-bar";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});
const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const roboto = Roboto({ variable: "--font-roboto", subsets: ["latin"] });
const bebasNeue = Bebas_Neue({
  variable: "--font-bebas-neue",
  weight: "400",
  subsets: ["latin"],
});
const kodeMono = Kode_Mono({
  variable: "--font-kode-mono",
  subsets: ["latin"],
});
const poppins = Poppins({
  variable: "--font-poppins",
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
});
const montserrat = Montserrat({
  variable: "--font-montserrat",
  subsets: ["latin"],
});
const openSans = Open_Sans({
  variable: "--font-open-sans",
  subsets: ["latin"],
});
const lato = Lato({
  variable: "--font-lato",
  weight: ["400", "700"],
  subsets: ["latin"],
});
const raleway = Raleway({ variable: "--font-raleway", subsets: ["latin"] });
const playfair = Playfair_Display({
  variable: "--font-playfair",
  subsets: ["latin"],
});

const siteName = env.NEXT_PUBLIC_SITE_NAME;
const siteUrl = env.NEXT_PUBLIC_SITE_URL;
const siteDescription = env.NEXT_PUBLIC_SITE_DESCRIPTION;
const title = `${siteName} – Interactive Chemistry Learning for Kids`;
const ogImage = absoluteUrl("/og-image.png");

export const metadata: Metadata = {
  title,
  description: siteDescription,
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
  metadataBase: new URL(siteUrl),
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title,
    description: siteDescription,
    url: siteUrl,
    siteName,
    type: "website",
    images: [
      {
        url: ogImage,
        width: 1200,
        height: 630,
        alt: `${siteName} - Interactive Chemistry Learning`,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description: siteDescription,
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

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`
          ${bebasNeue.variable} ${geistSans.variable} ${geistMono.variable}
          ${inter.variable} ${kodeMono.variable} ${roboto.variable}
          ${poppins.variable} ${montserrat.variable} ${openSans.variable}
          ${lato.variable} ${raleway.variable} ${playfair.variable}
          antialiased
        `}
        style={{ fontFamily: "var(--active-font, var(--font-kodeMono))" }}
      >
        <Providers>
          {/* Page content — pb-24 prevents content from hiding behind the nav bar */}
          <main className="pb-24">
            {children}
            <footer className="text-center py-4 text-sm text-gray-500">
              Made with ❤️ by JayemScript
            </footer>
          </main>

          {/* Renders on every route automatically */}
          <FloatingNavBar />
        </Providers>
      </body>
    </html>
  );
}
