import { describe, expect, it } from "vitest";

import {
  chooseTranslation,
  pick,
  preferred,
  showsStaleNotice,
  usesTranslation,
  type TranslationState,
} from "@/db/queries/_locale";

/**
 * Which copy a reader is shown.
 *
 * Small enough to read at a glance and important enough to be wrong quietly:
 * every mistake here is invisible to the person making it, because the page
 * renders perfectly either way. The reader is the only one who finds out.
 */

const published: TranslationState = { present: true, status: "published" };

describe("chooseTranslation", () => {
  it("falls back when no translation exists", () => {
    expect(chooseTranslation({ present: false }, "prose")).toBe("fallback");
    expect(chooseTranslation({ present: false }, "assessed")).toBe("fallback");
  });

  it("falls back for a draft, whatever the policy", () => {
    // Someone's half-finished work is not a reader's problem to discover.
    for (const status of ["draft", "in_review"] as const) {
      expect(chooseTranslation({ present: true, status }, "prose")).toBe(
        "fallback",
      );
      expect(chooseTranslation({ present: true, status }, "assessed")).toBe(
        "fallback",
      );
    }
  });

  it("falls back for a row with no status at all", () => {
    // Defensive rather than theoretical: a left join that misses returns
    // nulls, and "null status" must not read as "published".
    expect(chooseTranslation({ present: true, status: null }, "prose")).toBe(
      "fallback",
    );
  });

  it("shows a current translation unqualified", () => {
    expect(chooseTranslation({ ...published, stale: false }, "prose")).toBe(
      "translation",
    );
    expect(chooseTranslation({ ...published, stale: false }, "assessed")).toBe(
      "translation",
    );
  });

  it("keeps a stale article, with a notice", () => {
    // Swapping an Arabic reader to English halfway through an article is more
    // jarring than telling them it may be behind.
    expect(chooseTranslation({ ...published, stale: true }, "prose")).toBe(
      "translation-with-notice",
    );
  });

  it("drops a stale question back to the default locale", () => {
    // A stale question may no longer match the options it is scored against.
    // A banner does not fix a wrong answer.
    expect(chooseTranslation({ ...published, stale: true }, "assessed")).toBe(
      "fallback",
    );
  });

  it("treats a null stale flag as current", () => {
    // `stale` is a SQL comparison that can come back null when the join found
    // nothing; the `present` check above has already handled that case, and
    // reading null as "stale" here would put a notice on every page.
    expect(chooseTranslation({ ...published, stale: null }, "prose")).toBe(
      "translation",
    );
  });
});

describe("the readers of that choice", () => {
  it("agree on what each choice means", () => {
    expect(showsStaleNotice("translation-with-notice")).toBe(true);
    expect(showsStaleNotice("translation")).toBe(false);
    expect(showsStaleNotice("fallback")).toBe(false);

    expect(usesTranslation("translation")).toBe(true);
    expect(usesTranslation("translation-with-notice")).toBe(true);
    expect(usesTranslation("fallback")).toBe(false);
  });
});

describe("preferred", () => {
  it("takes the translation when there is one", () => {
    expect(preferred("الأحماض", "Acids")).toBe("الأحماض");
  });

  it("falls back on null and on undefined, but not on an empty string", () => {
    expect(preferred(null, "Acids")).toBe("Acids");
    expect(preferred(undefined, "Acids")).toBe("Acids");
    // A translator who deliberately left a field empty said something; `??`
    // keeps that, where `||` would silently show English instead.
    expect(preferred("", "Acids")).toBe("");
  });
});

describe("pick", () => {
  const current = { status: "published" as const, stale: false };

  it("returns the translation when the rule allows it", () => {
    expect(pick("Acids", "الأحماض", current, "prose")).toBe("الأحماض");
  });

  it("returns the base copy when the rule refuses", () => {
    expect(
      pick("Acids", "الأحماض", { status: "draft", stale: false }, "prose"),
    ).toBe("Acids");
    expect(
      pick(
        "Acids",
        "الأحماض",
        { status: "published", stale: true },
        "assessed",
      ),
    ).toBe("Acids");
  });

  it("derives presence from the value, so a missed join falls back", () => {
    // The left join returning null IS the absent row. Asking each call site to
    // restate that is asking one of them to get it wrong.
    expect(pick("Acids", null, current, "prose")).toBe("Acids");
    expect(pick("Acids", undefined, current, "prose")).toBe("Acids");
  });

  it("still serves a stale article, because prose keeps its notice", () => {
    expect(
      pick("Acids", "الأحماض", { status: "published", stale: true }, "prose"),
    ).toBe("الأحماض");
  });
});
