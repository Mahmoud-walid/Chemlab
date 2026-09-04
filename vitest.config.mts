import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

/**
 * Two projects, because they have different needs:
 *
 * - `unit` runs in jsdom with no I/O at all. It is the inner loop, and it must
 *   stay fast enough that nobody is tempted to skip it.
 * - `integration` runs in node against a real Postgres. It is where SQL,
 *   migrations, constraints and server-action authorisation are proven —
 *   things a mocked `db` object will happily let you get wrong.
 *
 * `pnpm test` runs unit only; `pnpm test:integration` and `pnpm test:all`
 * are explicit. See tests/README.md.
 */
export default defineConfig({
  plugins: [react()],
  resolve: { tsconfigPaths: true },
  test: {
    restoreMocks: true,
    clearMocks: true,
    projects: [
      {
        // Inherits plugins from the config above.
        resolve: {
          tsconfigPaths: true,
          alias: {
            // See tests/stubs/server-only.ts — the real guard still applies to
            // the build; jsdom simply cannot satisfy it.
            "server-only": new URL(
              "./tests/stubs/server-only.ts",
              import.meta.url,
            ).pathname,
          },
        },
        test: {
          name: "unit",
          environment: "jsdom",
          globals: true,
          setupFiles: ["./tests/setup.ts"],
          include: [
            "tests/{lib,hooks,components,data,i18n,db}/**/*.test.{ts,tsx}",
          ],
          restoreMocks: true,
          clearMocks: true,
        },
      },
      {
        resolve: {
          tsconfigPaths: true,
          alias: {
            // The modules under test are server-only by design. Node can run
            // them perfectly well; it just cannot satisfy the React Server
            // Component condition the package checks for. The real guard
            // still applies to `pnpm build`.
            "server-only": new URL(
              "./tests/stubs/server-only.ts",
              import.meta.url,
            ).pathname,
          },
        },
        test: {
          name: "integration",
          environment: "node",
          globals: true,
          include: ["tests/integration/**/*.test.ts"],
          setupFiles: ["./tests/integration/setup.ts"],
          // The database is a shared resource; parallel files racing on the
          // same tables produce failures that look like flakes.
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
          restoreMocks: true,
          clearMocks: true,
        },
      },
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      reportsDirectory: "./coverage",
      include: ["lib/**/*.ts", "hooks/**/*.ts", "i18n/**/*.ts", "db/**/*.ts"],
      exclude: [
        "**/*.d.ts",
        "db/migrations/**",
        "db/schema/**",
        // Framework glue with no logic of ours: navigation.ts re-exports
        // next-intl's createNavigation, and request.ts is a config factory
        // that only resolves the locale — logic which lives in routing.ts
        // precisely so it can be tested without next-intl's server build.
        "i18n/navigation.ts",
        "i18n/request.ts",
        // Auth glue the UNIT project cannot execute, each excluded for a
        // stated reason rather than by lowering the bar. The logic these
        // modules would otherwise contain was deliberately pulled out into
        // pure modules that ARE measured here: auth-schemas, auth-rate-limit,
        // safe-redirect, initials and env.server.schema all sit at 100%.
        //
        // auth-options.ts is the one worth arguing about. It is
        // security-relevant configuration, and it is exercised — by the 33
        // integration tests, which run the real options against real Postgres.
        // It reads as 0% only because this gate runs the unit project alone,
        // and the integration project needs a database the `verify` job has
        // no reason to provision.
        "lib/auth-options.ts",
        // Constructs the instance from those options; needs the Next runtime.
        "lib/auth.ts",
        // One createAuthClient() call, in the browser.
        "lib/auth-client.ts",
        // next/headers, react cache and redirect — no logic of ours, and the
        // behaviour that matters is proven end to end in tests/e2e/auth.spec.ts.
        "lib/session.ts",
        // A `server-only` guard over env.server.schema, which is measured.
        "lib/env.server.ts",
        // A dotenv side effect at import time.
        "lib/load-env.ts",
        // The database-and-session half of authorization: react cache, the
        // session read and one join. The LOGIC lives in authz-core.ts, which is
        // measured, and the behaviour that matters — union across roles,
        // immediate revocation, the Super Admin short-circuit — is proven
        // against real Postgres in tests/integration/rbac.test.ts.
        "lib/authz.ts",
        // Three lines around next/headers and one insert. The guarantee that
        // matters (the log cannot be edited) is a database trigger, proven in
        // tests/integration/rbac.test.ts.
        "lib/audit.ts",
      ],
      // Deliberately per-area rather than one global gate. A single 80% number
      // drives people to write assertion-free tests over presentational code
      // to move it; the areas below are where a bug is expensive and the code
      // is pure enough that high coverage is honest.
      thresholds: {
        "lib/**/*.ts": {
          statements: 85,
          branches: 75,
          functions: 85,
          lines: 85,
        },
        "i18n/**/*.ts": {
          statements: 80,
          branches: 70,
          functions: 80,
          lines: 80,
        },
      },
    },
  },
});
