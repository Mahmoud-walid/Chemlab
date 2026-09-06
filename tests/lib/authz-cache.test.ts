import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { cache } from "react";
import { describe, expect, it } from "vitest";

/**
 * The per-request permission cache, guarded the only way it can be here.
 *
 * #22's last criterion asks that rendering a page which checks permissions in
 * several components issues ONE query. The cache that makes that true is
 * `cache(getPermissionContext)` in `lib/authz.ts`, and the way it silently
 * stops being true is not the cache breaking — it is a caller going around it,
 * by importing the uncached `loadPermissionContext` into a component. Every
 * such component then issues its own query, the page still renders correctly,
 * and nothing anywhere says so.
 *
 * So this asserts the precondition mechanically: the uncached form is used by
 * `lib/authz.ts` itself and by scripts, and by nothing that renders.
 *
 * It does NOT count queries, and the first test below records why that cannot
 * be done from here — see the comment on it, and the note on #22.
 */

const ROOT = process.cwd();

/**
 * The uncached form is legitimate in exactly these places: the module that
 * defines the cached wrapper around it, and the offline entry points that
 * have a user id already and no request scope to cache in.
 */
const MAY_USE_UNCACHED = [
  "lib/authz.ts",
  // Scripts run outside a request. There is no scope, so there is nothing to
  // share and nothing to defeat — see the first test below.
  "scripts/",
  "tests/",
];

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      files.push(...(await walk(full)));
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      files.push(full);
    }
  }
  return files;
}

describe("the per-request permission cache", () => {
  it("does nothing outside a request scope, which is why this file is static", async () => {
    // Not a test of React — a record of the constraint that shapes the rest of
    // this file, and the reason #22's query-count criterion is still open.
    //
    // `cache()` memoises per REQUEST, via the scope React's server runtime
    // installs. In a plain Node test there is no such scope and it degrades to
    // a passthrough. So an integration test that called the cached accessor
    // twice and counted queries would measure two, conclude the cache was
    // broken, and be wrong. Counting the real thing needs a real request.
    let calls = 0;
    const counted = cache(async () => {
      calls += 1;
      return calls;
    });

    await counted();
    await counted();
    await counted();

    expect(
      calls,
      "if this is ever 1, React gained a scope here and the query-count " +
        "assertion #22 asks for becomes possible in this project",
    ).toBe(3);
  });

  it("finds the files to check", async () => {
    // If the walk returns nothing, every assertion below passes vacuously.
    const files = [
      ...(await walk(path.join(ROOT, "app"))),
      ...(await walk(path.join(ROOT, "components"))),
      ...(await walk(path.join(ROOT, "lib"))),
    ];
    expect(files.length).toBeGreaterThan(0);
  });

  it("is never bypassed by rendering code reaching for the uncached form", async () => {
    const files = [
      ...(await walk(path.join(ROOT, "app"))),
      ...(await walk(path.join(ROOT, "components"))),
      ...(await walk(path.join(ROOT, "lib"))),
    ];

    const offenders: string[] = [];

    for (const file of files) {
      const relative = path.relative(ROOT, file);
      if (MAY_USE_UNCACHED.some((allowed) => relative.startsWith(allowed))) {
        continue;
      }

      const source = await readFile(file, "utf8");
      if (source.includes("loadPermissionContext")) offenders.push(relative);
    }

    expect(
      offenders,
      "these reach past the per-request cache, so each one issues its own " +
        "permission query on every render — use can() or requirePermission()",
    ).toEqual([]);
  });

  it("keeps the cached accessor as the only thing the helpers call", async () => {
    // The other half of the same property: `can`, `requirePermission` and
    // `getEffectivePermissions` are what everything else uses, so if any of
    // THEM took the uncached path the guard above would pass while every
    // caller still issued a query each.
    const source = await readFile(path.join(ROOT, "lib/authz.ts"), "utf8");

    // Every mention that is a CALL rather than the declaration itself. There
    // should be exactly one: the cached wrapper's. A second means some helper
    // took the uncached path, and every caller of that helper then issues its
    // own query per render.
    const calls = (source.match(/\bloadPermissionContext\(/g) ?? []).length;
    const declarations = (
      source.match(/function loadPermissionContext\(/g) ?? []
    ).length;

    expect(declarations, "expected exactly one definition").toBe(1);
    expect(
      calls - declarations,
      "loadPermissionContext should be called only by the cached wrapper, " +
        "never by a helper that callers reach through",
    ).toBe(1);
  });
});
