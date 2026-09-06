import { expect, test } from "@playwright/test";

/**
 * The Google sign-in journey, with Google itself intercepted.
 *
 * #13 asks for this journey and for the rule that no test may call Google.
 * Until now the second half was true only because the first half did not
 * exist: there was no Google test, so of course none of them called Google.
 * That is a criterion passing for no reason, which is the failure mode this
 * suite has already been bitten by more than once.
 *
 * What a real test of this can prove without a real Google account is the part
 * that actually breaks: the handoff. `pnpm env:check` warns when
 * `BETTER_AUTH_URL` and `NEXT_PUBLIC_SITE_URL` disagree, because the callback
 * is registered against the auth origin — but nothing verified that the URL
 * the browser is actually sent to carries the right client id, the right
 * redirect URI and the scopes the app needs. A misconfiguration there surfaces
 * as an opaque failure on Google's own error page, which is the worst place to
 * find out.
 *
 * So: the button is clicked for real, Better Auth builds the authorize URL for
 * real, the browser is really sent to it — and the request is answered by this
 * file instead of leaving the machine.
 */

test.describe.configure({ timeout: 120_000 });

/** Everything Google would serve. Nothing here reaches the network. */
const GOOGLE = "https://accounts.google.com/**";

/**
 * The credentials CI runs with are deliberately fake, and the ones on a
 * developer's laptop are real. The assertions below are therefore about the
 * SHAPE of the authorize URL — that the app sent its configured client id and
 * a callback on its own origin — never about a particular value, which would
 * pass on one machine and fail on the other.
 */
test.describe("signing in with Google", () => {
  test("sends the browser to Google with a callback on our own origin", async ({
    page,
    baseURL,
  }) => {
    /** The authorize URL the app produced, captured instead of followed. */
    let authorize: URL | undefined;

    await page.route(GOOGLE, async (route) => {
      authorize = new URL(route.request().url());
      // Answered here. A real navigation would leave the machine, need a real
      // account, and make this test a check on Google's uptime.
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<html><body>intercepted</body></html>",
      });
    });

    await page.goto("/en/sign-in");

    const button = page.getByRole("button", { name: /continue with google/i });
    // Absent means `googleConfigured()` said no — which is a configuration
    // problem in the environment running the suite, not a passing test. CI
    // sets throwaway values precisely so this path is exercised.
    await expect(button).toBeVisible();
    await button.click();

    await expect
      .poll(() => authorize?.origin, { timeout: 15_000 })
      .toBe("https://accounts.google.com");

    const params = authorize!.searchParams;

    // An authorization-code flow, not the implicit one: the token must be
    // exchanged server-side, where the client secret lives.
    expect(params.get("response_type")).toBe("code");

    // Whatever the environment's client id is, it must have reached the URL.
    // An empty or missing one is the configuration bug this catches.
    expect(params.get("client_id")).toBeTruthy();

    // The part worth the whole test. The callback must point back at THIS
    // app's origin — a redirect URI pointing anywhere else is either a
    // misconfiguration that fails on Google's error page, or a redirect this
    // app should never have been willing to construct.
    const redirect = new URL(params.get("redirect_uri")!);
    expect(redirect.origin).toBe(new URL(baseURL!).origin);
    expect(redirect.pathname).toContain("/api/auth/callback/google");

    // Identity only. A quiz app asking for a reader's mailbox would be a
    // scope creep worth failing a build over.
    const scope = params.get("scope") ?? "";
    expect(scope).toContain("email");
    expect(scope).toContain("profile");
    expect(scope).not.toContain("gmail");
    expect(scope).not.toContain("drive");
  });

  test("never reaches Google when the button is not clicked", async ({
    page,
  }) => {
    // The rule #13 actually asks for, asserted rather than assumed: loading
    // the sign-in page must not contact Google. A tracking pixel, a font, or
    // a prefetch of the provider would all break this — silently, and only
    // for readers whose network cannot reach Google at all.
    const attempts: string[] = [];
    await page.route(GOOGLE, async (route) => {
      attempts.push(route.request().url());
      await route.abort();
    });

    await page.goto("/en/sign-in");
    await expect(
      page.getByRole("button", { name: /continue with google/i }),
    ).toBeVisible();

    expect(attempts).toEqual([]);
  });
});
