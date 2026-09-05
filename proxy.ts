import createMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";

import { pageStateFor, sessionHoldsBypass } from "@/db/queries/pages";
import { routing } from "@/i18n/routing";
import { isAlwaysOpen } from "@/lib/pages/routes";
import { safeRedirect } from "@/lib/safe-redirect";

/**
 * `proxy.ts`, not `middleware.ts`.
 *
 * Next 16 deprecated the `middleware` file convention and renamed it to
 * `proxy` — same capabilities, new name, and it now defaults to the Node.js
 * runtime rather than the edge. That is what makes the page switch below
 * possible: the open/closed map is a database read, which the edge runtime
 * could not do without a separate store.
 */

const intlMiddleware = createMiddleware(routing);

/** Path prefixes, after the locale segment, that anonymous traffic cannot see. */
const PROTECTED = ["/profile", "/admin"];

/**
 * Better Auth's session cookie. The `__Secure-` prefix is added in production,
 * so both names are checked.
 */
/**
 * Names the closed route a bypass holder was let through to, so the banner can
 * appear on that page and nowhere else. Read by a client component; see
 * components/customs/page-closed-banner.tsx for why it is a cookie.
 */
const BYPASS_COOKIE = "page-bypass";

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
export async function proxy(request: NextRequest) {
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

  // next-intl decides the locale first, because the maintenance rewrite needs
  // it: with `localePrefix: "as-needed"` an English URL carries no prefix, and
  // rewriting to a bare "/maintenance" would miss `app/[locale]/` entirely.
  const intlResponse = intlMiddleware(request);

  const closed = await closedResponse(request, path, intlResponse);
  if (closed) return closed;

  return withPathname(request, intlResponse);
}

/**
 * The locale next-intl settled on for this request.
 *
 * Read from its own rewrite rather than re-derived: re-running the negotiation
 * here would be a second implementation of it, and the two would disagree the
 * first time either changed.
 */
function localeFrom(response: NextResponse, request: NextRequest): string {
  const rewrite = response.headers.get("x-middleware-rewrite");
  const path = rewrite
    ? new URL(rewrite, request.url).pathname
    : request.nextUrl.pathname;

  const first = path.split("/").filter(Boolean)[0];
  return (routing.locales as readonly string[]).includes(first ?? "")
    ? first!
    : routing.defaultLocale;
}

/**
 * The page open/close switch.
 *
 * Decided here rather than in a layout because the status line is only open
 * before the response starts streaming — the same constraint that leaves a
 * section-permission refusal answering 200 (Q31). A closed page rewrites to
 * `/maintenance`, which renders the operator's message.
 *
 * A holder of `page:bypass` passes through and sees a banner instead. The
 * bypass is decided from a COOKIE, not from a permission query: the proxy runs
 * ahead of every request, and a role lookup here would put a second query in
 * front of every asset. The cookie is set by the admin layout, which HAS done
 * the permission query — so the worst a forged cookie buys is a preview of a
 * page that is merely closed, never data, and never a permission. Everything
 * behind a real permission is still checked by the page that serves it.
 */
async function closedResponse(
  request: NextRequest,
  path: string,
  intlResponse: NextResponse,
): Promise<NextResponse | null> {
  // Never consulted for admin, auth or profile routes — closing those would
  // close the page that reopens them, so they have no row and no lookup.
  if (isAlwaysOpen(path)) return null;

  const state = await pageStateFor(path);
  if (!state || state.isEnabled) {
    // Clear a stale banner cookie, but only for the few requests that carry
    // one — a Set-Cookie on every response would defeat caching for everyone.
    if (request.cookies.has(BYPASS_COOKIE)) {
      const opened = withPathname(request, intlResponse);
      opened.cookies.delete(BYPASS_COOKIE);
      return opened;
    }
    return null;
  }

  // Only now, on a page that is actually closed, is the bypass worth a query.
  const token = SESSION_COOKIES.map(
    (name) => request.cookies.get(name)?.value,
  ).find(Boolean);

  if (await sessionHoldsBypass(token)) {
    // Through to the real page, with a cookie naming the route that was
    // bypassed. A bypass holder who cannot tell a closed page from an open one
    // will report it fixed while visitors still cannot reach it.
    //
    // A cookie rather than a request header, because the banner that reads it
    // has to be a client component: reading `headers()` in the public layout
    // makes every route under it dynamic, which costs the 282 prerendered
    // pages. Forging it shows yourself a banner and nothing more — the bypass
    // itself was decided above, from the session.
    const passed = withPathname(request, intlResponse);
    passed.cookies.set(BYPASS_COOKIE, state.routeKey, {
      path: "/",
      httpOnly: false,
      sameSite: "lax",
      maxAge: 60 * 60,
    });
    return passed;
  }

  // The INTERNAL path, always locale-prefixed — that is what `app/[locale]`
  // matches, whether or not the visitor's URL carries the prefix.
  const url = new URL(
    `/${localeFrom(intlResponse, request)}/maintenance`,
    request.url,
  );

  // A rewrite, not a redirect: the closed URL stays in the address bar, so a
  // reload lands on the page again the moment it reopens, and a link somebody
  // shared does not silently become a link to the maintenance page.
  const rewrite = NextResponse.rewrite(url);

  // Carry next-intl's own headers across — the NEXT_LOCALE cookie among them,
  // without which visiting a closed page would forget the locale choice.
  for (const [key, value] of intlResponse.headers) {
    if (key.startsWith("x-middleware-")) continue;
    rewrite.headers.set(key, value);
  }

  return withPathname(request, rewrite);
}

/**
 * Forwards the request path to the server components.
 *
 * A server component cannot read its own URL, and two things need it: the
 * `next` parameter `requireUser()` builds, and the admin layout's check of the
 * section permission — which has to happen at the layout, because once it has
 * streamed, a `notFound()` deeper in the tree can change the BODY but not the
 * status.
 *
 * `response.headers.set()` does not do this. That sets a header on the
 * response going to the BROWSER; `headers()` in a server component reads the
 * request. The value has to be attached with `request: { headers }`, which
 * means re-issuing whatever next-intl decided rather than mutating it.
 */
function withPathname(
  request: NextRequest,
  response: NextResponse,
): NextResponse {
  const headers = new Headers(request.headers);
  headers.set("x-pathname", request.nextUrl.pathname);

  // A redirect has no downstream render, so there is nothing to forward to.
  if (response.headers.has("Location")) return response;

  const rewrite = response.headers.get("x-middleware-rewrite");
  const next = rewrite
    ? NextResponse.rewrite(new URL(rewrite, request.url), {
        request: { headers },
      })
    : NextResponse.next({ request: { headers } });

  // Carry next-intl's own headers across — the NEXT_LOCALE cookie among them,
  // without which the locale choice is forgotten on the next request.
  //
  // Every `x-middleware-*` header is skipped, not just the rewrite. Next
  // encodes `request: { headers }` as `x-middleware-override-headers` plus one
  // `x-middleware-request-<name>` per header, so copying next-intl's copy of
  // that machinery over ours replaced our override list with theirs — and
  // `x-pathname` silently never arrived. The symptom was a breadcrumb showing
  // a record id and a maintenance page unable to find its own message, with
  // nothing failing anywhere.
  for (const [key, value] of response.headers) {
    if (key.startsWith("x-middleware-")) continue;
    next.headers.set(key, value);
  }
  return next;
}

export const config = {
  // Skip API routes, Next internals, and anything that looks like a file, so
  // static assets are never rewritten through the locale matcher.
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
