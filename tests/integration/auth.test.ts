import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { betterAuth } from "better-auth";
import { eq, inArray, like } from "drizzle-orm";
import { uuidv7 } from "uuidv7";

import { connect, seedUrl, type SeedDatabase } from "@/db/seed/connect";
import * as schema from "@/db/schema";
import { buildAuthOptions } from "@/lib/auth-options";

/**
 * The auth handler against real Postgres.
 *
 * The instance is built here rather than imported from `lib/auth.ts`, which
 * reads `getServerEnv()` and `getDb()` and belongs to the Next.js runtime —
 * but the OPTIONS come from `buildAuthOptions`, the same function production
 * uses. That matters: the first version of these tests hand-rolled the options,
 * silently dropped the profile hook and the CSRF origin list, and passed.
 *
 * The one deliberate difference is Google, which needs credentials no CI run
 * has.
 */

let db: SeedDatabase;
let close: () => Promise<void>;
// The precise generic depends on the options object, so it is inferred from
// the factory rather than pinned to the library's default.
let auth: ReturnType<typeof buildInstance>;

function buildInstance(db: SeedDatabase) {
  return betterAuth(
    buildAuthOptions({
      db,
      secret: "test-secret-at-least-32-characters-long",
      baseURL: BASE_URL,
    }),
  );
}

const BASE_URL = "http://localhost:3000";
const PASSWORD = "correct-horse-battery";

beforeAll(() => {
  const url = seedUrl();
  if (!url) throw new Error("no database URL");
  ({ db, close } = connect(url));

  auth = buildInstance(db);
});

afterAll(async () => {
  await close?.();
});

/**
 * Scoped to this suite's own domain, not the whole table.
 *
 * `.invalid` is reserved by RFC 2606, so these can never collide with a real
 * address. Wiping every user would also try to remove whoever holds
 * `super_admin` on a seeded database, which the trigger correctly refuses —
 * a suite that assumes it owns the users table is a suite that breaks the
 * moment the database has real data in it.
 */
const TEST_DOMAIN = "%@auth-test.invalid";

beforeEach(async () => {
  // Cascades take sessions, accounts, profiles and role assignments with them.
  await db.delete(schema.users).where(like(schema.users.email, TEST_DOMAIN));
  await db.delete(schema.authAttempts);
});

/**
 * Scoped queries.
 *
 * The suite shares a database with seeded roles and with the other integration
 * suites, so "how many users are there?" is not a question it can ask — only
 * "how many of MINE".
 */
const mine = () => like(schema.users.email, TEST_DOMAIN);

async function testUsers() {
  return db.select().from(schema.users).where(mine());
}

async function countTestUsers() {
  return (await testUsers()).length;
}

/** Sessions, accounts and profiles belonging to this suite's users. */
async function rowsForTestUsers<T extends { userId: string }>(
  rows: T[],
): Promise<T[]> {
  const ids = new Set((await testUsers()).map((user) => user.id));
  return rows.filter((row) => ids.has(row.userId));
}

async function testSessions() {
  return rowsForTestUsers(await db.select().from(schema.sessions));
}

async function testAccounts() {
  return rowsForTestUsers(await db.select().from(schema.accounts));
}

async function testProfiles() {
  return rowsForTestUsers(await db.select().from(schema.profiles));
}

/** A real Request, so the origin and CSRF checks see what a browser sends. */
function post(path: string, body: unknown, headers: HeadersInit = {}) {
  return new Request(`${BASE_URL}/api/auth${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: BASE_URL,
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

async function signUp(email: string) {
  return auth.handler(
    post("/sign-up/email", { email, password: PASSWORD, name: "Ada Lovelace" }),
  );
}

/** The session cookie from a Set-Cookie header, ready to send back. */
function sessionCookie(response: Response): string {
  const raw = response.headers.getSetCookie();
  const token = raw
    .map((cookie) => cookie.split(";")[0]!)
    .find((cookie) => cookie.startsWith("better-auth.session_token="));
  if (!token) throw new Error("no session cookie was set");
  return token;
}

describe("sign-up", () => {
  it("creates a user, a credential account and a profile", async () => {
    const response = await signUp("ada@auth-test.invalid");
    expect(response.status).toBe(200);

    const [user] = await testUsers();
    expect(user?.email).toBe("ada@auth-test.invalid");
    // UUID v7, so ids stay time-ordered rather than scattering index writes.
    expect(user?.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-/);

    const [account] = await testAccounts();
    expect(account?.providerId).toBe("credential");
    expect(account?.userId).toBe(user!.id);

    const [profile] = await testProfiles();
    expect(profile?.userId).toBe(user!.id);
    expect(profile?.displayName).toBe("Ada Lovelace");
    expect(profile?.locale).toBe("en");
  });

  it("never stores the password in the clear", async () => {
    await signUp("ada@auth-test.invalid");
    const [account] = await testAccounts();

    expect(account?.password).toBeTruthy();
    expect(account?.password).not.toBe(PASSWORD);
    expect(account?.password).not.toContain(PASSWORD);
    // A memory-hard hash, not a bare digest.
    expect(account!.password!.length).toBeGreaterThan(40);
  });

  it("refuses a second account on the same email", async () => {
    expect((await signUp("ada@auth-test.invalid")).status).toBe(200);
    expect((await signUp("ada@auth-test.invalid")).status).not.toBe(200);
    expect(await countTestUsers()).toBe(1);
  });

  it("rejects a password below the minimum length", async () => {
    const response = await auth.handler(
      post("/sign-up/email", {
        email: "ada@auth-test.invalid",
        password: "short",
        name: "Ada",
      }),
    );
    expect(response.status).not.toBe(200);
    expect(await countTestUsers()).toBe(0);
  });
});

describe("sign-in", () => {
  beforeEach(async () => {
    await signUp("ada@auth-test.invalid");
    await db.delete(schema.sessions).where(
      inArray(
        schema.sessions.userId,
        (await testUsers()).map((user) => user.id),
      ),
    );
  });

  it("issues a session row and an httpOnly cookie", async () => {
    const response = await auth.handler(
      post("/sign-in/email", {
        email: "ada@auth-test.invalid",
        password: PASSWORD,
      }),
    );
    expect(response.status).toBe(200);

    const [session] = await testSessions();
    expect(session).toBeTruthy();
    expect(session!.expiresAt.getTime()).toBeGreaterThan(Date.now());

    const cookie = response.headers
      .getSetCookie()
      .find((value) => value.startsWith("better-auth.session_token="))!;
    // Not readable from JavaScript, and not sent on a cross-site POST.
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\//);
  });

  it("rejects the wrong password and creates no session", async () => {
    const response = await auth.handler(
      post("/sign-in/email", {
        email: "ada@auth-test.invalid",
        password: "not-the-password",
      }),
    );
    expect(response.status).not.toBe(200);
    expect((await testSessions()).length).toBe(0);
  });

  it("answers an unknown email the same way as a wrong password", async () => {
    // Different statuses here would let anyone enumerate which addresses have
    // accounts — the list worth selling.
    const unknown = await auth.handler(
      post("/sign-in/email", {
        email: "nobody@auth-test.invalid",
        password: PASSWORD,
      }),
    );
    const wrong = await auth.handler(
      post("/sign-in/email", {
        email: "ada@auth-test.invalid",
        password: "not-the-password",
      }),
    );
    expect(unknown.status).toBe(wrong.status);
  });
});

describe("sessions", () => {
  let cookie: string;

  beforeEach(async () => {
    await signUp("ada@auth-test.invalid");
    // Sign-up signs the new user in, so it leaves a session of its own.
    // Clearing it keeps "how many sessions exist" unambiguous below.
    await db.delete(schema.sessions).where(
      inArray(
        schema.sessions.userId,
        (await testUsers()).map((user) => user.id),
      ),
    );

    const response = await auth.handler(
      post("/sign-in/email", {
        email: "ada@auth-test.invalid",
        password: PASSWORD,
      }),
    );
    cookie = sessionCookie(response);
    expect((await testSessions()).length).toBe(1);
  });

  const getSession = (headers: HeadersInit) =>
    auth.handler(new Request(`${BASE_URL}/api/auth/get-session`, { headers }));

  it("resolves a valid cookie to the user", async () => {
    const response = await getSession({ Cookie: cookie });
    const body = (await response.json()) as {
      user?: { email?: string };
    } | null;
    expect(body?.user?.email).toBe("ada@auth-test.invalid");
  });

  it("stops resolving once the row is deleted", async () => {
    // The entire reason for database sessions over stateless JWTs: an admin
    // must be able to revoke access now, not at token expiry.
    await db.delete(schema.sessions);
    const response = await getSession({ Cookie: cookie });
    expect(await response.json()).toBeNull();
  });

  it("stops resolving once the row has expired", async () => {
    await db
      .update(schema.sessions)
      .set({ expiresAt: new Date(Date.now() - 1000) });
    const response = await getSession({ Cookie: cookie });
    expect(await response.json()).toBeNull();
  });

  it("sign-out deletes the row and the replayed cookie is refused", async () => {
    const out = await auth.handler(post("/sign-out", {}, { Cookie: cookie }));
    expect(out.status).toBe(200);
    expect((await testSessions()).length).toBe(0);

    const replay = await getSession({ Cookie: cookie });
    expect(await replay.json()).toBeNull();
  });

  it("does not resolve a forged cookie", async () => {
    const response = await getSession({
      Cookie: "better-auth.session_token=made-up-token.made-up-signature",
    });
    expect(await response.json()).toBeNull();
  });

  it("deleting a user takes their sessions with them", async () => {
    const [user] = await testUsers();
    await db.delete(schema.users).where(eq(schema.users.id, user!.id));
    expect((await testSessions()).length).toBe(0);
    expect((await testProfiles()).length).toBe(0);
  });
});

describe("rate limiting", () => {
  beforeEach(async () => {
    await signUp("ada@auth-test.invalid");
  });

  const attempt = (password: string) =>
    auth.handler(
      post("/sign-in/email", { email: "ada@auth-test.invalid", password }),
    );

  it("locks out after repeated failures and records them hashed", async () => {
    for (let i = 0; i < 5; i++) {
      expect((await attempt("not-the-password")).status).not.toBe(429);
    }
    // The sixth is refused before the password is even checked.
    expect((await attempt("not-the-password")).status).toBe(429);

    const rows = await db.select().from(schema.authAttempts);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      // The key is a hash: this table must not become a list of everyone who
      // has ever tried to sign in here.
      expect(row.key).toMatch(/^[0-9a-f]{64}$/);
      expect(row.key).not.toContain("ada");
    }
  });

  it("locks out the correct password too, rather than leaking that it is correct", async () => {
    // A limiter that lets the right password through would announce which
    // guess was right.
    for (let i = 0; i < 5; i++) await attempt("not-the-password");
    expect((await attempt(PASSWORD)).status).toBe(429);
  });

  it("does not lock out an address with no recent failures", async () => {
    await signUp("grace@auth-test.invalid");
    for (let i = 0; i < 6; i++) await attempt("not-the-password");

    // Ada is locked out; Grace must not be collateral damage.
    const response = await auth.handler(
      post("/sign-in/email", {
        email: "grace@auth-test.invalid",
        password: PASSWORD,
      }),
    );
    expect(response.status).toBe(200);
  });
});

describe("cross-origin requests", () => {
  it("refuses a state-changing request from another origin", async () => {
    // Without this a hostile page could drive sign-in or sign-out using the
    // visitor's cookies.
    const response = await auth.handler(
      post(
        "/sign-up/email",
        { email: "ada@auth-test.invalid", password: PASSWORD, name: "Ada" },
        { Origin: "https://evil.example" },
      ),
    );
    expect(response.status).toBe(403);
    expect(await countTestUsers()).toBe(0);
  });
});

describe("account linking", () => {
  // Unique per run: `accounts` has a unique index on (provider_id, account_id),
  // so a fixed subject makes the test depend on the database being empty.
  const subject = () => `google-subject-${uuidv7()}`;

  it("adds a row to accounts rather than a second user", async () => {
    // The linking rule this issue enforces is that one person is one `users`
    // row. A full Google round trip cannot run here, so the invariant is
    // asserted at the level the schema guarantees it: a second provider is a
    // second `accounts` row against the same user id.
    await signUp("ada@auth-test.invalid");
    const [user] = await testUsers();

    await db.insert(schema.accounts).values({
      id: uuidv7(),
      userId: user!.id,
      accountId: subject(),
      providerId: "google",
      issuer: "https://accounts.google.com",
    });

    expect(await countTestUsers()).toBe(1);
    const accounts = await db
      .select()
      .from(schema.accounts)
      .where(eq(schema.accounts.userId, user!.id));
    expect(accounts.map((row) => row.providerId).sort()).toEqual([
      "credential",
      "google",
    ]);
  });

  it("refuses the same provider subject twice", async () => {
    await signUp("ada@auth-test.invalid");
    const [user] = await testUsers();
    const row = {
      userId: user!.id,
      accountId: subject(),
      providerId: "google",
      issuer: "https://accounts.google.com",
    };

    await db.insert(schema.accounts).values({ id: uuidv7(), ...row });
    // Without the unique index a race could attach one Google identity to two
    // users.
    await expect(
      db.insert(schema.accounts).values({ id: uuidv7(), ...row }),
    ).rejects.toThrow();
  });
});
