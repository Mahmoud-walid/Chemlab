import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";

import { getDb } from "@/db/client";
import { profiles, type Profile } from "@/db/schema/auth";
import { getAuth } from "@/lib/auth";
import { authConfigured, getServerEnv } from "@/lib/env.server";
import { safeRedirect } from "@/lib/safe-redirect";

/**
 * Reading the current user on the server.
 *
 * Everything here is authoritative — unlike the middleware, which only looks
 * for a cookie. A server component, route handler or server action must call
 * one of these and must never trust a user id supplied by the request.
 */

export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
  profile: Profile | null;
}

/**
 * `cache` is per-request, so a layout, a page and three components all asking
 * "who is this?" cost one lookup rather than five.
 */
export const getSession = cache(async () => {
  // Auth being unconfigured is a normal state — the site serves every public
  // page without it — so this returns "nobody" rather than throwing.
  if (!authConfigured(getServerEnv())) return null;

  return getAuth().api.getSession({ headers: await headers() });
});

/** The signed-in user with their profile, or null. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const session = await getSession();
  if (!session?.user) return null;

  const [profile] = await getDb()
    .select()
    .from(profiles)
    .where(eq(profiles.userId, session.user.id))
    .limit(1);

  return {
    id: session.user.id,
    name: session.user.name,
    email: session.user.email,
    emailVerified: session.user.emailVerified,
    image: session.user.image ?? null,
    profile: profile ?? null,
  };
});

/**
 * The gate for a protected page or server action.
 *
 * Redirects an anonymous visitor to `/sign-in?next=…` pointing back at where
 * they were. The path comes from the `x-pathname` header the middleware sets —
 * a server component cannot read its own URL — and is run through the same
 * validator as the query parameter, so a header injected upstream cannot turn
 * this into an open redirect.
 */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (user) return user;

  const pathname = (await headers()).get("x-pathname");
  const next = safeRedirect(pathname, "/profile");
  redirect(`/sign-in?next=${encodeURIComponent(next)}`);
}

/**
 * The gate for a ROUTE HANDLER, where a redirect would be the wrong answer.
 *
 * `requireUser()` sends an anonymous visitor to the sign-in page, which is
 * right for a page and wrong for an API: a `fetch` follows the redirect, gets
 * 200 and a mountain of HTML, and the caller has no way to tell its request
 * failed.
 *
 * Returns EITHER the user or a ready-made 401, never both, so a handler cannot
 * carry on without one. A helper that returned `CurrentUser | null` would be a
 * rubber stamp — it would satisfy `tests/lib/authz-enforcement.test.ts` while
 * letting the caller ignore the null, which is the exact failure that test
 * exists to catch.
 */
export type ApiSession =
  | { user: CurrentUser; response?: undefined }
  | { user?: undefined; response: Response };

export async function requireUserOr401(): Promise<ApiSession> {
  const user = await getCurrentUser();
  if (user) return { user };

  return {
    response: Response.json({ error: "sign in" }, { status: 401 }),
  };
}
