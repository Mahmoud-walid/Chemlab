import createMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";

import { routing } from "@/i18n/routing";
import { safeRedirect } from "@/lib/safe-redirect";

const intlMiddleware = createMiddleware(routing);

/** Path prefixes, after the locale segment, that anonymous traffic cannot see. */
const PROTECTED = ["/profile", "/admin"];

/**
 * Better Auth's session cookie. The `__Secure-` prefix is added in production,
 * so both names are checked.
 */
const SESSION_COOKIES = [
  "better-auth.session_token",
  "__Secure-better-auth.session_token",
];

/** The locale prefix on a path, or "" when there is none (the default locale). */
function localePrefixOf(pathname: string): string {
  for (const locale of routing.locales) {
    if (pathname === `/${locale}` || pathname.startsWith(`/${locale}/`)) {
      return `/${locale}`;
    }
  }
  return "";
}

/** Strips a leading `/en` or `/ar` so the check is locale-independent. */
function withoutLocale(pathname: string): string {
  const prefix = localePrefixOf(pathname);
  if (!prefix) return pathname;
  return pathname.slice(prefix.length) || "/";
}

/**
 * A CHEAP cookie-presence check, and nothing more.
 *
 * This bounces obviously-anonymous traffic away from `/profile/*` and
 * `/admin/*` before it costs a render. It is not, and must never become, the
 * authoritative gate: middleware runs on the edge, cannot reach the database
 * cheaply, and a cookie's mere presence proves nothing about whether the
 * session behind it still exists. Every protected page, route handler and
 * server action does its own `requireUser()` — see lib/session.ts.
 */
export default function middleware(request: NextRequest) {
  const path = withoutLocale(request.nextUrl.pathname);
  const isProtected = PROTECTED.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );

  if (isProtected) {
    const hasCookie = SESSION_COOKIES.some(
      (name) => request.cookies.get(name)?.value,
    );
    if (!hasCookie) {
      // Prefixed with the visitor's locale, or an Arabic reader is bounced to
      // the English sign-in page. `localePrefix: "as-needed"` means the
      // default locale carries no prefix, so "" is correct for English.
      const prefix = localePrefixOf(request.nextUrl.pathname);
      const signIn = new URL(`${prefix}/sign-in`, request.url);
      // Round-tripped through the same validator the sign-in page uses, so a
      // crafted path cannot become an off-origin redirect after sign-in.
      signIn.searchParams.set(
        "next",
        safeRedirect(request.nextUrl.pathname + request.nextUrl.search),
      );
      return NextResponse.redirect(signIn);
    }
  }

  const response = intlMiddleware(request);
  // Server components cannot read their own URL. This lets `requireUser()`
  // build an accurate `next` parameter instead of guessing.
  response.headers.set("x-pathname", request.nextUrl.pathname);
  return response;
}

export const config = {
  // Skip API routes, Next internals, and anything that looks like a file, so
  // static assets are never rewritten through the locale matcher.
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
