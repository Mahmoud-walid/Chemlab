// Before anything reads process.env: the browser tests and the server they
// drive must see the same database as `pnpm db:seed`, and a hosted dev
// container can carry a DATABASE_URL of its own. See lib/load-env.ts.
import "./lib/load-env";
import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.PORT ?? 3000);
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;
const isCI = !!process.env.CI;

/**
 * Escape hatch for environments that ship a pre-installed Chromium whose
 * revision does not match this Playwright version — set
 * PLAYWRIGHT_CHROMIUM_EXECUTABLE to that binary. CI installs its own browsers
 * and leaves this unset.
 */
const chromiumExecutable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
const launch = chromiumExecutable
  ? { launchOptions: { executablePath: chromiumExecutable } }
  : {};

export default defineConfig({
  testDir: "./tests/e2e",
  // A test that only passes when it runs alone is not a passing test.
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? 2 : undefined,
  reporter: isCI
    ? [["html", { open: "never" }], ["github"], ["list"]]
    : [["html", { open: "never" }], ["list"]],
  timeout: 30_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL,
    // Traces only on a retry: cheap when green, and the failure that matters
    // arrives with a full timeline.
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], ...launch },
      // RTL specs belong to the Arabic project below, which supplies the
      // locale they assert against.
      testIgnore: /.*\.rtl\.spec\.ts/,
    },
    // Arabic and RTL are a first-class layout, not an afterthought, so they
    // get a project rather than living inside ad-hoc assertions.
    {
      name: "chromium-rtl",
      use: {
        ...devices["Desktop Chrome"],
        ...launch,
        locale: "ar-EG",
        extraHTTPHeaders: { "Accept-Language": "ar" },
      },
      testMatch: /.*\.rtl\.spec\.ts/,
    },
  ],

  // Tests run against a production build: dev-only behaviour (unminified
  // React, no static optimisation) hides real problems.
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: isCI ? "pnpm start" : "pnpm build && pnpm start",
        url: baseURL,
        reuseExistingServer: !isCI,
        timeout: 180_000,
        stdout: "pipe",
        stderr: "pipe",
      },
});
