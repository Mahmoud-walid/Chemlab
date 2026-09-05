import "./lib/load-env";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        /**
         * The service worker must never be served from cache.
         *
         * A browser that caches `sw.js` keeps running the OLD worker
         * indefinitely once it is installed — the classic failure mode of this
         * whole feature, and one that looks like "push stopped working for
         * some users" rather than like a caching bug. `no-cache` means the
         * browser revalidates every time, so a deployed change takes effect on
         * the next page load.
         */
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, must-revalidate" },
          // Its scope is the whole origin. Without this header a worker served
          // from the root is still root-scoped, but stating it makes the
          // intent explicit if the file ever moves.
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
