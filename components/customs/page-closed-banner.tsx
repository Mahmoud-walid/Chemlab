"use client";

import { useHydrated } from "@/hooks/use-hydrated";
import { Link, usePathname } from "@/i18n/navigation";

/**
 * Tells a bypass holder that what they are looking at, visitors cannot see.
 *
 * Without it the bypass is a trap: the page looks entirely normal, so whoever
 * is checking a fix reports it working while everyone else still gets the
 * maintenance page.
 *
 * A CLIENT component reading a cookie, not a server one reading a header.
 * Reading `headers()` here would make every route under the public layout
 * dynamic — it did, and it cost all 282 prerendered pages before this was
 * caught. The cookie is written by the proxy on the response it lets through.
 *
 * The cookie is purely a display signal and is deliberately forgeable: the
 * bypass itself is decided server-side from the session's permissions, so
 * setting this by hand shows you a banner and nothing else.
 */
const COOKIE = "page-bypass";

function bypassedRoute(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE}=`));
  return match ? decodeURIComponent(match.slice(COOKIE.length + 1)) : null;
}

export function PageClosedBanner({
  /**
   * Resolved by the layout and passed in, rather than read from a client
   * catalogue: this is the only client consumer of the `pages` namespace, and
   * shipping the whole namespace to every visitor to serve two strings to an
   * operator is the wrong trade.
   */
  labels,
}: {
  labels: { notice: string; manage: string };
}) {
  const pathname = usePathname();

  // Nothing on the server or during hydration, so the prerendered markup is
  // identical for everyone and the page stays prerenderable. The banner is a
  // notice for one person, not content — reading the cookie after hydration is
  // exactly what `useHydrated` exists for.
  const hydrated = useHydrated();
  const route = hydrated ? bypassedRoute() : null;

  // The cookie names the route that was bypassed, so a stale one from an
  // earlier page cannot put the banner on an unrelated page.
  const applies =
    route !== null &&
    (route === "/"
      ? pathname === "/"
      : pathname === route || pathname.startsWith(`${route}/`));

  if (!applies) return null;

  return (
    <div
      role="status"
      className="border-b border-amber-500/40 bg-amber-500/10 px-4 py-2 text-center text-sm"
    >
      <span>{labels.notice}</span>{" "}
      <Link
        href="/admin/pages"
        className="font-medium underline underline-offset-4"
      >
        {labels.manage}
      </Link>
    </div>
  );
}
