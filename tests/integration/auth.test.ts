import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { betterAuth } from "better-auth";
import { eq, sql } from "drizzle-orm";
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

beforeEach(async () => {
  // Cascades take sessions, accounts and profiles with them.
  await db.delete(schema.users);
  await db.delete(schema.authAttempts);
});

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
    const response = await signUp("ada@example.com");
    expect(response.status).toBe(200);

    const [user] = await db.select().from(schema.users);
    expect(user?.email).toBe("ada@example.com");
    // UUID v7, so ids stay time-ordered rather than scattering index writes.
    expect(user?.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-/);

    const [account] = await db.select().from(schema.accounts);
    expect(account?.providerId).toBe("credential");
    expect(account?.userId).toBe(user!.id);

    const [profile] = await db.select().from(schema.profiles);
    expect(profile?.userId).toBe(user!.id);
    expect(profile?.displayName).toBe("Ada Lovelace");
    expect(profile?.locale).toBe("en");
  });

  it("never stores the password in the clear", async () => {
    await signUp("ada@example.com");
    const [account] = await db.select().from(schema.accounts);

    expect(account?.password).toBeTruthy();
    expect(account?.password).not.toBe(PASSWORD);
    expect(account?.password).not.toContain(PASSWORD);
    // A memory-hard hash, not a bare digest.
    expect(account!.password!.length).toBeGreaterThan(40);
  });

  it("refuses a second account on the same email", async () => {
    expect((await signUp("ada@example.com")).status).toBe(200);
    expect((await signUp("ada@example.com")).status).not.toBe(200);
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.users);
    expect(count).toBe(1);
  });

  it("rejects a password below the minimum length", async () => {
    const response = await auth.handler(
      post("/sign-up/email", {
        email: "ada@example.com",
        password: "short",
        name: "Ada",
      }),
    );
    expect(response.status).not.toBe(200);
    expect(await db.$count(schema.users)).toBe(0);
  });
});

describe("sign-in", () => {
  beforeEach(async () => {
    await signUp("ada@example.com");
    await db.delete(schema.sessions);
  });

  it("issues a session row and an httpOnly cookie", async () => {
    const response = await auth.handler(
      post("/sign-in/email", { email: "ada@example.com", password: PASSWORD }),
    );
    expect(response.status).toBe(200);

    const [session] = await db.select().from(schema.sessions);
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
        email: "ada@example.com",
        password: "not-the-password",
      }),
    );
    expect(response.status).not.toBe(200);
    expect(await db.$count(schema.sessions)).toBe(0);
  });

  it("answers an unknown email the same way as a wrong password", async () => {
    // Different statuses here would let anyone enumerate which addresses have
    // accounts — the list worth selling.
    const unknown = await auth.handler(
      post("/sign-in/email", {
        email: "nobody@example.com",
        password: PASSWORD,
      }),
    );
    const wrong = await auth.handler(
      post("/sign-in/email", {
        email: "ada@example.com",
        password: "not-the-password",
      }),
    );
    expect(unknown.status).toBe(wrong.status);
  });
});

describe("sessions", () => {
  let cookie: string;

  beforeEach(async () => {
    await signUp("ada@example.com");
    // Sign-up signs the new user in, so it leaves a session of its own.
    // Clearing it keeps "how many sessions exist" unambiguous below.
    await db.delete(schema.sessions);

    const response = await auth.handler(
      post("/sign-in/email", { email: "ada@example.com", password: PASSWORD }),
    );
    cookie = sessionCookie(response);
    expect(await db.$count(schema.sessions)).toBe(1);
  });

  const getSession = (headers: HeadersInit) =>
    auth.handler(new Request(`${BASE_URL}/api/auth/get-session`, { headers }));

  it("resolves a valid cookie to the user", async () => {
    const response = await getSession({ Cookie: cookie });
    const body = (await response.json()) as {
      user?: { email?: string };
    } | null;
    expect(body?.user?.email).toBe("ada@example.com");
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
    expect(await db.$count(schema.sessions)).toBe(0);

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
    const [user] = await db.select().from(schema.users);
    await db.delete(schema.users).where(eq(schema.users.id, user!.id));
    expect(await db.$count(schema.sessions)).toBe(0);
    expect(await db.$count(schema.profiles)).toBe(0);
  });
});

describe("rate limiting", () => {
  beforeEach(async () => {
    await signUp("ada@example.com");
  });

  const attempt = (password: string) =>
    auth.handler(
      post("/sign-in/email", { email: "ada@example.com", password }),
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
    await signUp("grace@example.com");
    for (let i = 0; i < 6; i++) await attempt("not-the-password");

    // Ada is locked out; Grace must not be collateral damage.
    const response = await auth.handler(
      post("/sign-in/email", {
        email: "grace@example.com",
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
        { email: "ada@example.com", password: PASSWORD, name: "Ada" },
        { Origin: "https://evil.example" },
      ),
    );
    expect(response.status).toBe(403);
    expect(await db.$count(schema.users)).toBe(0);
  });
});

describe("account linking", () => {
  it("adds a row to accounts rather than a second user", async () => {
    // The linking rule this issue enforces is that one person is one `users`
    // row. A full Google round trip cannot run here, so the invariant is
    // asserted at the level the schema guarantees it: a second provider is a
    // second `accounts` row against the same user id.
    await signUp("ada@example.com");
    const [user] = await db.select().from(schema.users);

    await db.insert(schema.accounts).values({
      id: uuidv7(),
      userId: user!.id,
      accountId: "google-subject-123",
      providerId: "google",
      issuer: "https://accounts.google.com",
    });

    expect(await db.$count(schema.users)).toBe(1);
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
    await signUp("ada@example.com");
    const [user] = await db.select().from(schema.users);
    const row = {
      userId: user!.id,
      accountId: "google-subject-123",
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
