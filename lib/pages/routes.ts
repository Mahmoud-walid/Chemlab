/**
 * Which public routes can be taken offline, and how a request is matched to one.
 *
 * Pure — no database, no request — so the matching rules can be tested directly
 * and the same function can run in the proxy, in a server component and in a
 * script that reconciles the table against `app/`.
 */

/** Message keys under the `pages` namespace, as a literal union. */
export type PageTitleKey =
  | "home"
  | "lessons"
  | "quiz"
  | "quizResults"
  | "chemical"
  | "experiments"
  | "games";

export interface ClosableRoute {
  /** The route pattern, and the primary key of the `pages` table. */
  routeKey: string;
  titleKey: PageTitleKey;
  /**
   * Whether closing it should also remove it from `FloatingNavBar`. Routes the
   * nav never links to (an element detail page) have nothing to remove.
   */
  inNav: boolean;
}

/**
 * The routes an operator may close.
 *
 * A closed list, not a scan of `app/`: a kill switch is a decision about a
 * PAGE, and a route appearing under `app/` is not by itself a decision that it
 * should be closable. `scripts/pages-check.ts` reconciles the two and fails
 * when a new public route belongs to neither this list nor `ALWAYS_OPEN`.
 */
export const CLOSABLE_ROUTES: ClosableRoute[] = [
  { routeKey: "/", titleKey: "home", inNav: true },
  { routeKey: "/lessons", titleKey: "lessons", inNav: true },
  { routeKey: "/quiz", titleKey: "quiz", inNav: true },
  { routeKey: "/quiz/results", titleKey: "quizResults", inNav: false },
  { routeKey: "/chemical", titleKey: "chemical", inNav: false },
  { routeKey: "/experiments", titleKey: "experiments", inNav: true },
  { routeKey: "/games", titleKey: "games", inNav: true },
];

/**
 * Routes that are deliberately NOT closable, with the reason.
 *
 * These are the switches that would lock the operator out of the switch:
 *
 * - `/admin` — closing the admin panel closes the page that reopens it. There
 *   is no recovery from the UI, only a hand-written UPDATE against the
 *   database, and that is a support incident rather than a feature.
 * - `/sign-in`, `/sign-up` — reopening a page needs `page:update`, which needs
 *   a session, which needs sign-in. Closing it means nobody can sign in to
 *   reopen anything.
 * - `/profile` — a person's own account pages. "The site is down" is a
 *   maintenance decision; "you cannot reach your own data" is not the same
 *   thing, and it would strand anyone mid-session.
 * - `/maintenance` — the page a closed route rewrites TO. Closing it would
 *   rewrite the maintenance page to the maintenance page.
 */
export const ALWAYS_OPEN = [
  "/admin",
  "/sign-in",
  "/sign-up",
  "/profile",
  "/maintenance",
] as const;

const LOCALE_PREFIX = /^\/(en|ar)(?=\/|$)/;

/** Strips a leading `/en` or `/ar` so matching is locale-independent. */
export function withoutLocale(pathname: string): string {
  const stripped = pathname.replace(LOCALE_PREFIX, "");
  return stripped === "" ? "/" : stripped;
}

/** Does `pathname` fall under `routeKey`, counting its children? */
export function covers(routeKey: string, pathname: string): boolean {
  // "/" would otherwise prefix-match everything. It names the home page only;
  // taking the whole site down is not a page switch.
  if (routeKey === "/") return pathname === "/";
  return pathname === routeKey || pathname.startsWith(`${routeKey}/`);
}

/**
 * The route key governing a path, or null when no key covers it.
 *
 * The LONGEST match wins, which is what makes a child overridable: with both
 * `/quiz` and `/quiz/results` in the table, closing `/quiz` closes the
 * catalogue and every quiz under it, while `/quiz/results` keeps its own row
 * and can stay open. Without longest-match the parent would always win and the
 * child's row would be decoration.
 */
export function routeKeyFor(
  pathname: string,
  routeKeys: readonly string[] = CLOSABLE_ROUTES.map((r) => r.routeKey),
): string | null {
  const path = withoutLocale(pathname);

  let best: string | null = null;
  for (const key of routeKeys) {
    if (!covers(key, path)) continue;
    if (best === null || key.length > best.length) best = key;
  }
  return best;
}

/** Is this path one of the routes that can never be closed? */
export function isAlwaysOpen(pathname: string): boolean {
  const path = withoutLocale(pathname);
  return ALWAYS_OPEN.some((prefix) => covers(prefix, path));
}
