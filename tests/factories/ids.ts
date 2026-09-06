import { uuidv7 } from "uuidv7";

/**
 * Names that cannot collide.
 *
 * Every suite ends up needing this, and every suite that writes its own gets
 * it slightly differently — a timestamp here, a counter there, and one of
 * them collides the first time two workers run at the same second.
 *
 * A UUID v7 is unique without coordination and sorts by creation time, which
 * makes a failing row easy to place in a run.
 */
export function unique(prefix: string): string {
  return `${prefix}-${uuidv7()}`;
}

/**
 * A slug a cleanup can find.
 *
 * Suites delete by `like 'prefix-%'`, so the prefix has to survive at the
 * front. Kept here so the shape of a test slug is one decision rather than
 * thirty.
 */
export function testSlug(prefix: string): string {
  return unique(prefix);
}
