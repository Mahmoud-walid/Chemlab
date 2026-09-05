import "@/lib/load-env";
import { readdir } from "node:fs/promises";
import path from "node:path";

import { CLOSABLE_ROUTES, isAlwaysOpen } from "@/lib/pages/routes";

/**
 * Reconciles the routes under `app/` with the kill-switch list.
 *
 * The failure this exists to prevent: a new public page ships, nobody adds it
 * to `lib/pages/routes.ts`, and it silently has no switch — discovered on the
 * day somebody needs to take it down. A route must be a deliberate member of
 * exactly one of two sets: closable, or documented as always open.
 *
 * Reads the filesystem rather than the database, so it runs in CI with no
 * Postgres. The database side is covered by the integration suite, which
 * asserts a row exists for every closable route.
 */

const APP_ROOT = path.join(process.cwd(), "app", "[locale]");

/** Route groups — `(public)`, `(auth)` — are organisation, not URL segments. */
function isRouteGroup(segment: string): boolean {
  return segment.startsWith("(") && segment.endsWith(")");
}

/** A dynamic segment contributes a pattern, not a literal path. */
function isDynamic(segment: string): boolean {
  return segment.startsWith("[");
}

/** Every URL path with a `page.tsx`, with groups stripped and dynamics kept. */
async function routesUnder(dir: string, prefix = ""): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const found: string[] = [];

  if (entries.some((entry) => entry.isFile() && entry.name === "page.tsx")) {
    found.push(prefix === "" ? "/" : prefix);
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const next = isRouteGroup(entry.name) ? prefix : `${prefix}/${entry.name}`;
    found.push(...(await routesUnder(path.join(dir, entry.name), next)));
  }

  return found;
}

/**
 * The path a route key would have to cover.
 *
 * `/chemical/[slug]` is governed by the `/chemical` key, so the check asks
 * whether SOME key covers a concrete instance of the route rather than
 * comparing patterns to patterns.
 */
function concreteExample(route: string): string {
  return route
    .split("/")
    .map((segment) => (isDynamic(segment) ? "example" : segment))
    .join("/");
}

async function main() {
  const routes = [...new Set(await routesUnder(APP_ROOT))].sort();
  const closableKeys = CLOSABLE_ROUTES.map((route) => route.routeKey);

  const problems: string[] = [];

  for (const route of routes) {
    const example = concreteExample(route);
    if (isAlwaysOpen(example)) continue;

    const covered = closableKeys.some((key) =>
      key === "/"
        ? example === "/"
        : example === key || example.startsWith(`${key}/`),
    );

    if (!covered) {
      problems.push(
        `  ${route} — no route key covers it, and it is not in ALWAYS_OPEN`,
      );
    }
  }

  // The other direction: a key naming a route that no longer exists would keep
  // a switch for a page nobody can visit.
  for (const key of closableKeys) {
    const matches = routes.some((route) => {
      const example = concreteExample(route);
      return key === "/"
        ? example === "/"
        : example === key || example.startsWith(`${key}/`);
    });
    if (!matches) {
      problems.push(`  ${key} — a route key with no page under app/`);
    }
  }

  if (problems.length > 0) {
    console.error(
      [
        "Routes and the page kill switch disagree:",
        "",
        ...problems,
        "",
        "Every public route needs a deliberate answer. Add it to CLOSABLE_ROUTES",
        "in lib/pages/routes.ts (and a row in a migration), or to ALWAYS_OPEN with",
        "the reason it must never be closable.",
      ].join("\n"),
    );
    process.exit(1);
  }

  console.log(
    `pages: ${routes.length} routes, ${closableKeys.length} closable, the rest deliberately always open`,
  );
}

main();
