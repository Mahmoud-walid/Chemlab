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
        // Inherits plugins and resolve from the config above.
        test: {
          name: "unit",
          environment: "jsdom",
          globals: true,
          setupFiles: ["./tests/setup.ts"],
          include: [
            "tests/{lib,hooks,components,data,i18n}/**/*.test.{ts,tsx}",
          ],
          restoreMocks: true,
          clearMocks: true,
        },
      },
      {
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
