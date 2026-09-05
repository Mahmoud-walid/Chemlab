import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Authorization has to be *remembered* at every mutating entry point, and
 * "remember to call requirePermission" is not a control — it is a hope. This
 * test mechanically walks every server action and route handler and fails when
 * one mutates without checking.
 *
 * It reads source text rather than importing the modules: importing a route
 * handler drags in the Next.js runtime, the database and `server-only`, and a
 * test that cannot run is a test that gets deleted.
 */

const ROOT = process.cwd();

/** Handlers that legitimately mutate nothing an unauthorised caller could abuse. */
const ALLOWED_WITHOUT_CHECK = new Set([
  // Better Auth's own catch-all: sign-up and sign-in must work for people who
  // hold no permissions at all, and it does its own rate limiting and CSRF
  // checks. Guarding it with requirePermission would lock everyone out.
  "app/api/auth/[...all]/route.ts",
  // A liveness probe. It runs `select 1` — caught by the `execute(` heuristic,
  // but it mutates nothing and returns only `ok` and a latency figure. Kept
  // public on purpose: a health check behind auth cannot tell you the database
  // is down when auth is what is down.
  "app/api/health/db/route.ts",
]);

/**
 * A server action or handler that only reads the ACTING user's own data needs
 * a session, not a permission. `requireUser()` is the right gate there, and
 * counts as checked.
 */
/**
 * `requireUserOr401(` is the route-handler form: it returns null rather than
 * redirecting, because a `fetch` that follows a redirect to the sign-in page
 * gets 200 and HTML and cannot tell that it failed. It is a gate all the same
 * — the handler that calls it must answer 401 — and it is listed here so a
 * handler checking the session by hand still fails this test, which is the
 * whole point of the check.
 */
const GATES = ["requirePermission(", "requireUser(", "requireUserOr401("];

const MUTATION_HINTS = [
  ".insert(",
  ".update(",
  ".delete(",
  "execute(",
  "revalidatePath(",
  "revalidateTag(",
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

async function candidates(): Promise<{ file: string; source: string }[]> {
  const files = await walk(path.join(ROOT, "app"));
  const out: { file: string; source: string }[] = [];

  for (const file of files) {
    const source = await readFile(file, "utf8");
    const relative = path.relative(ROOT, file);
    const isServerAction = /^\s*["']use server["']/m.test(source);
    const isRouteHandler = relative.endsWith(`route.ts`);
    if (isServerAction || isRouteHandler) out.push({ file: relative, source });
  }
  return out;
}

describe("authorization is enforced at every mutating entry point", () => {
  it("finds the entry points to check", async () => {
    // If this ever returns nothing, the walk is broken and every assertion
    // below would pass vacuously.
    expect((await candidates()).length).toBeGreaterThan(0);
  });

  it("gates every server action and route handler that mutates", async () => {
    const unguarded: string[] = [];

    for (const { file, source } of await candidates()) {
      if (ALLOWED_WITHOUT_CHECK.has(file)) continue;

      const mutates = MUTATION_HINTS.some((hint) => source.includes(hint));
      if (!mutates) continue;

      const guarded = GATES.some((gate) => source.includes(gate));
      if (!guarded) unguarded.push(file);
    }

    expect(
      unguarded,
      "these mutate but call neither requirePermission() nor requireUser()",
    ).toEqual([]);
  });

  it("never trusts a user id supplied by the request", async () => {
    // The acting user comes from the session. A handler that reads a userId out
    // of the body or the query turns "edit my own thing" into "edit anyone's".
    const offenders: string[] = [];

    for (const { file, source } of await candidates()) {
      if (ALLOWED_WITHOUT_CHECK.has(file)) continue;
      if (
        /(formData|body|searchParams|params)[^\n]*\.get\(\s*["'](userId|user_id)["']/.test(
          source,
        ) ||
        /\bbody\.(userId|user_id)\b/.test(source)
      ) {
        offenders.push(file);
      }
    }

    expect(offenders, "these read a user id from the request").toEqual([]);
  });
});
