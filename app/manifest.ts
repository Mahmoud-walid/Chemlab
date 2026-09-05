import type { MetadataRoute } from "next";

import { env } from "@/lib/env";

/**
 * The web app manifest.
 *
 * This exists for one concrete reason beyond looking installable: **Safari on
 * iOS delivers Web Push only to a site installed to the Home Screen as a
 * standalone web app**, and installation requires a valid manifest with
 * `display: "standalone"`. A plain Safari tab will never receive a push, no
 * matter how correct the code is. So the manifest is part of #17's transport,
 * not decoration.
 *
 * It is NOT here to make Chemlab work offline. There is no caching strategy
 * and no offline page; adding one would be a different feature with different
 * failure modes.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: env.NEXT_PUBLIC_SITE_NAME,
    short_name: env.NEXT_PUBLIC_SITE_NAME,
    description: env.NEXT_PUBLIC_SITE_DESCRIPTION,
    start_url: "/",
    display: "standalone",
    // Matches `--background` and `--primary` in app/globals.css. A theme
    // colour that disagrees with the app shows as a band of the wrong colour
    // behind the status bar on Android.
    background_color: "#ffffff",
    theme_color: "#5d2a5c",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        // Cropped to whatever shape the platform likes, so its art sits inside
        // a safe circle. Without a maskable icon Android renders the ordinary
        // one letterboxed inside a white blob.
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
