import { describe, expect, it } from "vitest";

import {
  GENERIC_SIGN_IN_ERROR,
  MIN_PASSWORD_LENGTH,
  profileSchema,
  signInSchema,
  signUpSchema,
} from "@/lib/auth-schemas";

/**
 * These schemas run on the client for feedback and on the server for the
 * decision. The tests exist because the second use is the one that matters:
 * a client can post anything.
 */

describe("signUpSchema", () => {
  it("accepts a normal sign-up and normalises the email", () => {
    const result = signUpSchema.parse({
      name: "  Ada Lovelace  ",
      email: "  Ada@Example.COM ",
      password: "correct-horse-battery",
    });
    expect(result).toEqual({
      name: "Ada Lovelace",
      // Lowercased and trimmed, so "Ada@example.com" and "ada@example.com"
      // cannot become two accounts.
      email: "ada@example.com",
      password: "correct-horse-battery",
    });
  });

  it("rejects a password shorter than the minimum", () => {
    const short = "a".repeat(MIN_PASSWORD_LENGTH - 1);
    const result = signUpSchema.safeParse({
      name: "Ada",
      email: "ada@example.com",
      password: short,
    });
    expect(result.success).toBe(false);
  });

  it("accepts a long passphrase with no symbols", () => {
    // The whole point of the length rule: this is stronger than "P@ssw0rd!"
    // and must not be rejected for lacking punctuation.
    expect(
      signUpSchema.safeParse({
        name: "Ada",
        email: "ada@example.com",
        password: "several plain words together",
      }).success,
    ).toBe(true);
  });

  it("rejects trivial passwords that clear the length rule", () => {
    for (const password of ["password1234", "PASSWORD1234", "chemlab12345"]) {
      const result = signUpSchema.safeParse({
        name: "Ada",
        email: "ada@example.com",
        password,
      });
      expect(result.success, password).toBe(false);
    }
  });

  it("rejects a malformed email and an empty name", () => {
    expect(
      signUpSchema.safeParse({
        name: "Ada",
        email: "not-an-email",
        password: "correct-horse-battery",
      }).success,
    ).toBe(false);
    expect(
      signUpSchema.safeParse({
        name: "   ",
        email: "ada@example.com",
        password: "correct-horse-battery",
      }).success,
    ).toBe(false);
  });
});

describe("signInSchema", () => {
  it("does not apply the strength rules to an existing password", () => {
    // A password set under older rules must still be able to sign in, and
    // restating the rules here would tell an attacker what to generate.
    expect(
      signInSchema.safeParse({ email: "ada@example.com", password: "short" })
        .success,
    ).toBe(true);
  });

  it("still requires both fields", () => {
    expect(
      signInSchema.safeParse({ email: "ada@example.com", password: "" })
        .success,
    ).toBe(false);
    expect(
      signInSchema.safeParse({ email: "", password: "whatever" }).success,
    ).toBe(false);
  });

  it("offers one message that does not distinguish the failure modes", () => {
    // If "no such account" and "wrong password" read differently, the form is
    // a user-enumeration oracle.
    expect(GENERIC_SIGN_IN_ERROR).not.toMatch(
      /exist|unknown|found|registered/i,
    );
  });
});

describe("profileSchema", () => {
  it("accepts a profile and trims its text", () => {
    expect(
      profileSchema.parse({
        displayName: "  Ada  ",
        bio: "  Chemistry teacher.  ",
        locale: "ar",
      }),
    ).toEqual({ displayName: "Ada", bio: "Chemistry teacher.", locale: "ar" });
  });

  it("allows an absent bio but not an over-long one", () => {
    expect(
      profileSchema.safeParse({ displayName: "Ada", locale: "en" }).success,
    ).toBe(true);
    expect(
      profileSchema.safeParse({
        displayName: "Ada",
        bio: "x".repeat(501),
        locale: "en",
      }).success,
    ).toBe(false);
  });

  it("rejects a locale the app does not serve", () => {
    expect(
      profileSchema.safeParse({ displayName: "Ada", locale: "fr" }).success,
    ).toBe(false);
  });
});
