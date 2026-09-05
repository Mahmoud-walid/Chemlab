import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { uuidv7 } from "uuidv7";

import { connect, seedUrl, type SeedDatabase } from "@/db/seed/connect";
import * as schema from "@/db/schema";
import {
  getPageStates,
  invalidatePageCache,
  pageStateFor,
  sessionHoldsBypass,
  visibleNavRoutes,
} from "@/db/queries/pages";
import { CLOSABLE_ROUTES } from "@/lib/pages/routes";

/**
 * The page open/close switch, against real Postgres.
 *
 * The claims worth proving here are the ones a unit test cannot reach: that a
 * row exists for every route the code thinks is closable, that closing one is
 * felt by the lookup the proxy uses, and that the bypass is decided by an
 * actual permission rather than by anything a visitor can set.
 */

let db: SeedDatabase;
let close: () => Promise<void>;

beforeAll(() => {
  const url = seedUrl();
  if (!url) throw new Error("no database URL");
  ({ db, close } = connect(url));
});

afterAll(async () => {
  await close?.();
});

afterEach(async () => {
  // Every test here writes to a shared, seven-row table, so the reset is
  // unconditional rather than per-test bookkeeping.
  await db.update(schema.pages).set({
    isEnabled: true,
    showInNav: true,
    disabledAt: null,
    disabledBy: null,
  });
  await db
    .update(schema.pages)
    .set({ showInNav: false })
    .where(eq(schema.pages.routeKey, "/quiz/results"));
  await db
    .update(schema.pages)
    .set({ showInNav: false })
    .where(eq(schema.pages.routeKey, "/chemical"));
  invalidatePageCache();
});

async function close_(routeKey: string) {
  await db
    .update(schema.pages)
    .set({ isEnabled: false, disabledAt: new Date() })
    .where(eq(schema.pages.routeKey, routeKey));
  invalidatePageCache();
}

describe("the pages table", () => {
  it("has a row for every route the code believes is closable", async () => {
    // The migration seeds these. A route key with no row silently has no
    // switch — the proxy reads "no row" as open.
    const states = await getPageStates();
    for (const route of CLOSABLE_ROUTES) {
      expect(states.has(route.routeKey), route.routeKey).toBe(true);
    }
  });

  it("has no row for a route that must never be closable", async () => {
    const states = await getPageStates();
    for (const key of [
      "/admin",
      "/sign-in",
      "/sign-up",
      "/profile",
      "/maintenance",
    ]) {
      expect(states.has(key), key).toBe(false);
    }
  });

  it("starts with everything open", async () => {
    const states = await getPageStates();
    for (const [key, state] of states) {
      expect(state.isEnabled, key).toBe(true);
    }
  });
});

describe("closing a page", () => {
  it("is visible to the lookup the proxy uses, for the page and its children", async () => {
    await close_("/lessons");

    expect((await pageStateFor("/lessons"))?.isEnabled).toBe(false);
    expect((await pageStateFor("/lessons/acids-bases-ph"))?.isEnabled).toBe(
      false,
    );
    // Locale prefixes must not smuggle a visitor past the switch.
    expect((await pageStateFor("/ar/lessons"))?.isEnabled).toBe(false);
  });

  it("leaves every other route open", async () => {
    await close_("/lessons");

    expect((await pageStateFor("/quiz"))?.isEnabled).toBe(true);
    expect((await pageStateFor("/"))?.isEnabled).toBe(true);
    expect((await pageStateFor("/chemical/iron"))?.isEnabled).toBe(true);
  });

  it("does not close a child that has its own row", async () => {
    // The override the longest-match rule exists for: quizzes can be withdrawn
    // while a student can still see the result of one they already took.
    await close_("/quiz");

    expect((await pageStateFor("/quiz"))?.isEnabled).toBe(false);
    expect((await pageStateFor("/quiz/acids-and-bases"))?.isEnabled).toBe(
      false,
    );
    expect((await pageStateFor("/quiz/results"))?.isEnabled).toBe(true);
  });

  it("removes it from the navigation", async () => {
    expect(await visibleNavRoutes(CLOSABLE_ROUTES)).toContain("/lessons");

    await close_("/lessons");
    const open = await visibleNavRoutes(CLOSABLE_ROUTES);
    expect(open).not.toContain("/lessons");
    expect(open).toContain("/quiz");
  });

  it("is undone by reopening it", async () => {
    await close_("/games");
    expect((await pageStateFor("/games"))?.isEnabled).toBe(false);

    await db
      .update(schema.pages)
      .set({ isEnabled: true, disabledAt: null })
      .where(eq(schema.pages.routeKey, "/games"));
    invalidatePageCache();

    expect((await pageStateFor("/games"))?.isEnabled).toBe(true);
  });
});

describe("the cache", () => {
  it("serves a stale answer until it is invalidated", async () => {
    // Documenting the trade rather than pretending it does not exist: the
    // cache is why the switch is cheap, and the TTL is the ceiling on how long
    // a closed page stays reachable across processes.
    await getPageStates();

    await db
      .update(schema.pages)
      .set({ isEnabled: false })
      .where(eq(schema.pages.routeKey, "/games"));

    expect((await pageStateFor("/games"))?.isEnabled).toBe(true);

    invalidatePageCache();
    expect((await pageStateFor("/games"))?.isEnabled).toBe(false);
  });
});

describe("the nav filter", () => {
  it("hides a route flagged out of the nav even while it is open", async () => {
    await db
      .update(schema.pages)
      .set({ showInNav: false })
      .where(eq(schema.pages.routeKey, "/games"));
    invalidatePageCache();

    const open = await visibleNavRoutes(CLOSABLE_ROUTES);
    expect(open).not.toContain("/games");
    // Still reachable by URL — hidden from the nav is not closed.
    expect((await pageStateFor("/games"))?.isEnabled).toBe(true);
  });
});

describe("the bypass", () => {
  let userId: string;

  afterEach(async () => {
    if (userId) {
      await db.delete(schema.users).where(eq(schema.users.id, userId));
    }
  });

  async function makeSession(roleKey: string | null): Promise<string> {
    userId = uuidv7();
    // A fresh address per session, not one shared by the whole describe.
    // `users.email` is unique, and the shared address only worked while every
    // `afterEach` ran: one failing test left its user behind and the NEXT
    // test died on a unique violation, so a single failure took the rest of
    // the suite with it. Deriving it from the id cannot collide.
    await db.insert(schema.users).values({
      id: userId,
      email: `bypass-${userId}@pages.invalid`,
      name: "Bypass Probe",
      emailVerified: false,
    });

    if (roleKey) {
      const [role] = await db
        .select({ id: schema.roles.id })
        .from(schema.roles)
        .where(eq(schema.roles.key, roleKey));
      await db
        .insert(schema.userRoles)
        .values({ userId, roleId: role!.id })
        .onConflictDoNothing();
    }

    const token = `tok-${uuidv7()}`;
    await db.insert(schema.sessions).values({
      id: uuidv7(),
      userId,
      token,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    return token;
  }

  it("is refused when there is no session at all", async () => {
    expect(await sessionHoldsBypass(undefined)).toBe(false);
    expect(await sessionHoldsBypass("")).toBe(false);
  });

  it("is refused for a token nobody holds", async () => {
    // The switch must not be walkable past by inventing a cookie value.
    expect(await sessionHoldsBypass("not-a-real-token")).toBe(false);
    expect(await sessionHoldsBypass("not-a-real-token.signature")).toBe(false);
  });

  it("reads the token out of a signed cookie value", async () => {
    // Better Auth signs the cookie, so what arrives is `<token>.<signature>`
    // while the column stores only the token. Matching the whole cookie value
    // finds nothing, and the bypass silently never works.
    const token = await makeSession("admin");
    expect(await sessionHoldsBypass(`${token}.a-signature-suffix`)).toBe(true);
  });

  it("is refused for a signed-in member", async () => {
    const token = await makeSession("member");
    expect(await sessionHoldsBypass(token)).toBe(false);
  });

  it("is refused for an editor, who can publish but not bypass", async () => {
    const token = await makeSession("editor");
    expect(await sessionHoldsBypass(token)).toBe(false);
  });

  it("is granted to a role holding page:bypass", async () => {
    const token = await makeSession("admin");
    expect(await sessionHoldsBypass(token)).toBe(true);
  });

  it("is granted to a Super Admin, whose power is not a role_permissions row", async () => {
    const token = await makeSession("super_admin");
    expect(await sessionHoldsBypass(token)).toBe(true);
  });

  it("is refused once the session has expired", async () => {
    const token = await makeSession("admin");
    await db
      .update(schema.sessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.sessions.token, token));

    // A cookie outliving its session must not keep the bypass alive.
    expect(await sessionHoldsBypass(token)).toBe(false);
  });
});
