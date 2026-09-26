import { describe, expect, it } from "vitest";

import { describeError } from "@/lib/describe-error";

/**
 * The failure this module exists to prevent, reproduced.
 *
 * `pnpm db:seed` against a Neon database whose host would not resolve printed
 * "Seed failed; the transaction was rolled back." followed by
 * "[object Object]". The cause — a DNS failure — was sitting in the thrown
 * value the whole time, and the only reason the operator eventually saw it was
 * that `pnpm db:verify` does not catch, so Node printed the object itself.
 *
 * So the first test below is not a unit test of a formatter. It is the
 * regression test for a script that withheld the answer at the moment it was
 * asked for it.
 */

/**
 * The shape the Neon serverless driver actually throws: the `ws` package's
 * `ErrorEvent`, which is NOT an `Error`, carries a generic message, and hides
 * the real failure in `error`.
 */
class FakeErrorEvent {
  readonly type = "error";
  constructor(
    readonly error: Error,
    readonly message: string = "",
  ) {}
}

describe("the [object Object] regression", () => {
  it("reports the DNS failure a Neon ErrorEvent was hiding", () => {
    const dns = Object.assign(
      new Error("getaddrinfo EAI_AGAIN ep-xxx.eu-west-2.aws.neon.tech"),
      { code: "EAI_AGAIN", syscall: "getaddrinfo" },
    );
    const thrown = new FakeErrorEvent(dns);

    // Proof the old code could not have worked: this is why it printed
    // "[object Object]" rather than anything useful.
    expect(thrown instanceof Error).toBe(false);
    expect(String(thrown)).toBe("[object Object]");

    const described = describeError(thrown);
    expect(described).toContain("EAI_AGAIN");
    expect(described).not.toContain("[object Object]");
  });

  it("never returns [object Object] for a bare object", () => {
    // The general form of the same bug: anything thrown that is neither an
    // Error nor a string used to collapse to the same useless nine characters.
    expect(describeError({ weird: true })).not.toContain("[object Object]");
    expect(describeError({ weird: true })).toContain("weird");
  });
});

describe("describeError", () => {
  it("returns an Error's message", () => {
    expect(describeError(new Error("relation does not exist"))).toBe(
      "relation does not exist",
    );
  });

  it("returns a thrown string unchanged", () => {
    expect(describeError("plain failure")).toBe("plain failure");
  });

  it("walks the cause chain, so a wrapped driver error is not hidden", () => {
    // The DrizzleQueryError shape: the top message names the SQL, and the
    // failure that matters is underneath.
    const described = describeError(
      new Error("Failed query: select 1", {
        cause: new Error("connection terminated unexpectedly"),
      }),
    );
    expect(described).toContain("Failed query");
    expect(described).toContain("connection terminated unexpectedly");
  });

  it("lists an AggregateError's reasons rather than only its summary", () => {
    const described = describeError(
      new AggregateError(
        [new Error("ipv6 refused"), new Error("ipv4 timed out")],
        "all attempts failed",
      ),
    );
    expect(described).toContain("all attempts failed");
    expect(described).toContain("ipv6 refused");
    expect(described).toContain("ipv4 timed out");
  });

  it("survives a cause that points back at its own error", () => {
    // Reachable when a wrapper is re-thrown with itself as the cause. Without
    // the guard this repeats until the depth limit.
    const loop = new Error("outer") as Error & { cause?: unknown };
    const inner = new Error("inner", { cause: loop });
    loop.cause = inner;

    const described = describeError(loop);
    expect(described).toBe("outer\n  caused by: inner");
  });

  it("stops rather than following an unbounded chain", () => {
    let error = new Error("depth-0");
    for (let i = 1; i <= 20; i++) {
      error = new Error(`depth-${i}`, { cause: error });
    }
    // Not an assertion about the exact limit: what matters is that a long
    // chain is truncated instead of filling the terminal.
    expect(describeError(error).split("caused by:").length).toBeLessThan(10);
  });

  it("does not repeat a message the layer above already said", () => {
    const described = describeError(
      new Error("same thing", { cause: new Error("same thing") }),
    );
    expect(described).toBe("same thing");
  });

  it("handles a circular object without throwing", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => describeError(circular)).not.toThrow();
  });

  it("handles null and undefined", () => {
    expect(describeError(null)).toBe("null");
    // `undefined` ends the loop before the first line, which is honest: there
    // is nothing to describe.
    expect(describeError(undefined)).toBe("");
  });
});

describe("masking credentials", () => {
  it("masks the password in a connection string a driver quoted back", () => {
    // The failure this prevents: the operator's next move after a seed failure
    // is to paste the output into an issue, and CLAUDE.md section 1 says a
    // credential must never land there.
    const described = describeError(
      new Error(
        'connection to "postgresql://neondb_owner:npg_S3cr3tPw@ep-xxx.neon.tech/neondb" failed',
      ),
    );
    expect(described).not.toContain("npg_S3cr3tPw");
    expect(described).toContain("***");
    // The host still has to survive — it is the part that identifies which
    // database refused, and redacting it would trade one silence for another.
    expect(described).toContain("ep-xxx.neon.tech");
    expect(described).toContain("neondb_owner");
  });

  it("masks a password inside a nested cause too", () => {
    const described = describeError(
      new Error("Failed query", {
        cause: new Error("postgres://u:hunter2@db.internal:5432/app refused"),
      }),
    );
    expect(described).not.toContain("hunter2");
    expect(described).toContain("***");
  });

  it("leaves ordinary prose with a colon alone", () => {
    // The redaction is narrow on purpose: a broad pattern would eat text that
    // merely looks like a URL, and an error nobody can read is the bug being
    // fixed, not the fix.
    const text = "timeout: waited 5000ms for host db.internal:5432";
    expect(describeError(new Error(text))).toBe(text);
  });
});
