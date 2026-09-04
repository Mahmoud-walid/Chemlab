import { z } from "zod";

/**
 * The validation the sign-in and sign-up forms use — imported by BOTH the
 * client form and the server, so the server never relies on the client having
 * checked anything. A client can post whatever it likes.
 */

/**
 * Length beats composition rules: twelve characters of anything has more
 * entropy than eight with a symbol and a digit, and composition rules mostly
 * teach people to write `Password1!`.
 */
export const MIN_PASSWORD_LENGTH = 12;

/**
 * Passwords a length rule alone would wave through. Not a substitute for a
 * breach corpus — that belongs behind an API and is out of scope here — but it
 * stops the handful that appear first in every list.
 */
const TRIVIAL_PASSWORDS = new Set([
  "password1234",
  "passwordpassword",
  "123456789012",
  "qwertyuiop12",
  "letmeinletmein",
  "chemlab12345",
  "iloveyou1234",
  "adminadmin12",
]);

/**
 * Normalised BEFORE it is validated, not after.
 *
 * `.transform()` runs last, so trimming there would reject
 * " ada@example.com " — a trailing space is what a phone keyboard adds — with
 * "that does not look like an email address". Lowercasing early also means
 * "Ada@example.com" and "ada@example.com" cannot become two accounts.
 */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, { message: "Enter your email address." })
  .email({ message: "That does not look like an email address." })
  .max(254);

export const passwordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH, {
    message: `Use at least ${MIN_PASSWORD_LENGTH} characters. Length matters more than symbols.`,
  })
  .max(512, { message: "That password is too long." })
  .refine((value) => !TRIVIAL_PASSWORDS.has(value.toLowerCase()), {
    message: "That password is too easy to guess. Pick something else.",
  });

export const signInSchema = z.object({
  email: emailSchema,
  // Deliberately NOT `passwordSchema`: a password set under older rules must
  // still be able to sign in, and restating the strength rules on the sign-in
  // form tells an attacker exactly what to generate.
  password: z.string().min(1, { message: "Enter your password." }),
});

export const signUpSchema = z.object({
  // Trimmed before the length check, so a name of only spaces is empty rather
  // than three characters long.
  name: z
    .string()
    .trim()
    .min(1, { message: "Enter a name." })
    .max(80, { message: "That name is too long." }),
  email: emailSchema,
  password: passwordSchema,
});

export const profileSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(1, { message: "Enter a display name." })
    .max(80),
  bio: z
    .string()
    .trim()
    .max(500, { message: "Keep it under 500 characters." })
    .optional(),
  locale: z.enum(["en", "ar"]),
});

export type SignInInput = z.infer<typeof signInSchema>;
export type SignUpInput = z.infer<typeof signUpSchema>;
export type ProfileInput = z.infer<typeof profileSchema>;

/**
 * The one message both "no such email" and "wrong password" return.
 *
 * Distinguishing them turns the form into a user-enumeration oracle: an
 * attacker learns which addresses have accounts here, which is precisely the
 * list worth selling.
 */
export const GENERIC_SIGN_IN_ERROR =
  "That email and password do not match an account.";
