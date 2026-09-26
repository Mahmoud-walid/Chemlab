/**
 * Turns whatever was thrown into a line an operator can act on.
 *
 * The scripts in `scripts/` all used to do this:
 *
 *   error instanceof Error ? error.message : String(error)
 *
 * which is correct for an `Error` and useless for everything else. The Neon
 * serverless driver throws the WebSocket's own `ErrorEvent`, and that is not
 * an `Error` — so `String()` produced literally `[object Object]`, and
 * `pnpm db:seed` reported a rolled-back transaction while withholding the one
 * fact needed to fix it. The real cause was a DNS failure reachable only
 * through the event's `error` property.
 *
 * Two further shapes matter here. A `DrizzleQueryError` IS an `Error`, but its
 * message names the SQL and hides the driver failure underneath in `cause` —
 * so the chain has to be walked, not just the top. And `AggregateError` holds
 * its reasons in `errors`, which a plain `.message` never mentions.
 *
 * Free of `server-only` and of every import: it has to run from `scripts/`,
 * and the point of it is to work when other things are broken.
 */

/** How deep to follow `cause`. A cycle is possible, and so is a long chain. */
const MAX_DEPTH = 5;

/**
 * `postgresql://user:pw@host/db` -> `postgresql://user:***@host/db`
 *
 * Driver errors quote the connection string, and the operator's next move is
 * to paste the output into an issue or a chat — where, on this repository,
 * `CLAUDE.md` §1 says a credential must never end up. The same masking
 * `pnpm env:check` applies to what it prints deliberately is applied here to
 * what a failure prints by accident.
 */
function redactUrls(text: string): string {
  return text.replace(
    // A scheme, a user, then a password up to the `@`. Deliberately narrow:
    // matching more broadly would redact parts of ordinary prose.
    /\b([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+):[^\s@]+@/gi,
    "$1:***@",
  );
}

/** The message carried by one link in the chain, whatever its shape. */
function messageOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.message;

  if (typeof value === "object" && value !== null) {
    // An `ErrorEvent` — the Neon case — exposes `message`, and sometimes only
    // a useless one ("error"), with the detail in `error`. Prefer a message,
    // fall back to the nested error.
    const record = value as { message?: unknown; error?: unknown };
    if (typeof record.message === "string" && record.message.trim() !== "") {
      return record.message;
    }
    if (record.error !== undefined) return messageOf(record.error);

    // Last resort. JSON rather than `String()`, because `String()` on a plain
    // object is the `[object Object]` this module exists to eliminate — and a
    // shape nobody anticipated is still worth seeing.
    try {
      const json = JSON.stringify(value);
      if (json !== undefined && json !== "{}") return json;
    } catch {
      // A circular or unserialisable object falls through to the label below.
    }
    return `[unprintable ${value.constructor?.name ?? "object"}]`;
  }

  return String(value);
}

/** What this link points at next: a `cause`, an `error`, or nothing. */
function nextLink(value: unknown): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as { cause?: unknown; error?: unknown };
  if (record.cause !== undefined) return record.cause;
  // Only when `error` was not already consumed as the message: a `messageOf`
  // that fell through to `record.error` would otherwise repeat it.
  if (record.error !== undefined && typeof record.error === "object") {
    const hasOwnMessage =
      typeof (value as { message?: unknown }).message === "string" &&
      (value as { message: string }).message.trim() !== "";
    return hasOwnMessage ? record.error : undefined;
  }
  return undefined;
}

/**
 * A description of `error`, including what caused it, with credentials masked.
 *
 * Returned rather than logged so the caller decides the stream and the
 * prefix — and so this is testable without capturing console output.
 */
export function describeError(error: unknown): string {
  const lines: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;

  for (let depth = 0; depth < MAX_DEPTH && current !== undefined; depth++) {
    // A `cause` that points back up the chain would otherwise loop until the
    // depth limit, printing the same two messages three times.
    if (typeof current === "object" && current !== null) {
      if (seen.has(current)) break;
      seen.add(current);
    }

    const message = redactUrls(messageOf(current));
    // A link whose message repeats the one above it adds nothing; Drizzle and
    // the driver often phrase the same failure twice.
    if (message !== lines[lines.length - 1]) lines.push(message);

    // Guarded on the object check: `current` can be `null`, which is not
    // `undefined` and so reaches here, and reading a property off it throws —
    // in the one function that has to survive everything being broken.
    if (typeof current === "object" && current !== null) {
      const aggregate = current as { errors?: unknown };
      if (Array.isArray(aggregate.errors)) {
        for (const reason of aggregate.errors) {
          lines.push(`  - ${redactUrls(messageOf(reason))}`);
        }
      }
    }

    current = nextLink(current);
  }

  return lines.join("\n  caused by: ");
}
