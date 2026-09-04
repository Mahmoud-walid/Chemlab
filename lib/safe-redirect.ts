/**
 * Validates a `next` / `callbackURL` value before redirecting to it.
 *
 * An unvalidated redirect target is an open redirect: `/sign-in?next=https://
 * evil.example` sends a freshly authenticated user off-origin, and the padlock
 * plus the familiar sign-in page is exactly what makes the phish work.
 *
 * Only a same-origin ABSOLUTE PATH is accepted. Everything else — an absolute
 * URL, a protocol-relative `//host`, a backslash variant browsers normalise to
 * a slash, a control character — falls back to the caller's default.
 */
export const DEFAULT_REDIRECT = "/";

export function safeRedirect(
  target: string | null | undefined,
  fallback: string = DEFAULT_REDIRECT,
): string {
  if (!target) return fallback;

  // Control characters and whitespace can smuggle a scheme past a naive check
  // once the browser strips them: "java\nscript:" is one such trick.
  if (/[\u0000-\u0020]/.test(target)) return fallback;

  // Must be rooted, and must not be protocol-relative. Browsers treat "/\" and
  // "\\" like "//", so both slashes are rejected in the second position.
  if (!target.startsWith("/")) return fallback;
  if (target.length > 1 && (target[1] === "/" || target[1] === "\\")) {
    return fallback;
  }

  return target;
}
