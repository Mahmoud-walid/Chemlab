/**
 * Grants the Super Admin role to the account named by SUPER_ADMIN_EMAIL.
 *
 *   pnpm db:bootstrap-admin
 *
 * This exists because of a genuine chicken and egg: granting a role requires
 * `role:assign`, which requires being a Super Admin, and at the start nobody
 * is. So the first grant happens at deployment time, by the person with shell
 * access, rather than through an authorized API.
 *
 * It NEVER creates a user. The owner signs up through the normal flow first —
 * so the credential is created by Better Auth's own hashing, and no password
 * ever exists in a script, an env var, or a shell history. If no account
 * matches, this exits non-zero and says to sign up first.
 *
 * The rejected alternative is auto-promoting "the first user to ever sign up".
 * On a public deployment that is a land grab: whoever signs up during the
 * deploy window owns the platform.
 *
 * Idempotent. Re-running when the link already exists changes nothing.
 */
import "@/lib/load-env";
import { and, eq } from "drizzle-orm";

import * as schema from "@/db/schema";
import { SUPER_ADMIN_ROLE_KEY } from "@/db/schema/rbac";
import { connect, seedUrl } from "@/db/seed/connect";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

async function main() {
  const email = process.env.SUPER_ADMIN_EMAIL?.trim().toLowerCase();
  if (!email) {
    fail(
      [
        "SUPER_ADMIN_EMAIL is not set.",
        "",
        "Set it in .env.local or the deployment's environment to the email of",
        "the account that should hold the Super Admin role. It is server-only:",
        "never give it a NEXT_PUBLIC_ prefix.",
      ].join("\n"),
    );
  }

  const url = seedUrl();
  if (!url)
    fail("Set DATABASE_URL_UNPOOLED (preferred) or DATABASE_URL first.");

  const { db, close } = connect(url);

  try {
    const [user] = await db
      .select({ id: schema.users.id, email: schema.users.email })
      .from(schema.users)
      .where(eq(schema.users.email, email))
      .limit(1);

    if (!user) {
      fail(
        [
          `No account exists for ${email}.`,
          "",
          "Sign up once at /sign-up with that address, then run this again.",
          "This script deliberately does not create the account: doing so would",
          "mean a password living somewhere other than Better Auth's hashing.",
        ].join("\n"),
      );
    }

    const [role] = await db
      .select({ id: schema.roles.id })
      .from(schema.roles)
      .where(eq(schema.roles.key, SUPER_ADMIN_ROLE_KEY))
      .limit(1);

    if (!role) {
      fail(
        `The "${SUPER_ADMIN_ROLE_KEY}" role does not exist. Run pnpm db:seed first.`,
      );
    }

    const existing = await db
      .select({ userId: schema.userRoles.userId })
      .from(schema.userRoles)
      .where(
        and(
          eq(schema.userRoles.userId, user.id),
          eq(schema.userRoles.roleId, role.id),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      console.log(
        `${email} already holds ${SUPER_ADMIN_ROLE_KEY}. Nothing to do.`,
      );
      return;
    }

    await db.transaction(async (tx) => {
      await tx
        .insert(schema.userRoles)
        .values({ userId: user.id, roleId: role.id })
        .onConflictDoNothing();

      // Marked `bootstrap` because it has no acting user: it was performed by
      // whoever had shell access, which is exactly the fact worth recording.
      await tx.insert(schema.auditLog).values({
        actorId: null,
        action: "user_role.assign",
        targetType: "user_role",
        targetId: user.id,
        before: null,
        after: { role: SUPER_ADMIN_ROLE_KEY, via: "bootstrap", email },
      });
    });

    const holders = await db
      .select({ userId: schema.userRoles.userId })
      .from(schema.userRoles)
      .where(eq(schema.userRoles.roleId, role.id));

    console.log(`granted ${SUPER_ADMIN_ROLE_KEY} to ${email}`);
    console.log(`holders  ${holders.length}`);
    if (holders.length === 1) {
      console.log(
        "\nnote: one holder is a bus factor of one. The database refuses to\n" +
          "      remove the last Super Admin, so losing this account means\n" +
          "      losing administrative access. Consider a second holder.",
      );
    }
  } finally {
    await close();
  }
}

void main();
