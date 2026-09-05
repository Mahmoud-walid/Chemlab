import { describe, expect, it } from "vitest";
import { createTranslator } from "next-intl";

import en from "@/messages/en.json";
import ar from "@/messages/ar.json";
import { NOTIFICATION_TYPES } from "@/lib/notifications/types";

/**
 * Every notification type has copy, in both languages, resolvable the way
 * next-intl actually resolves it.
 *
 * This test exists because of a bug that shipped once already: message keys
 * containing dots are read as NESTING, so a flat `"lesson.liked": "…"` is
 * unreachable from any scope — `t("messages.lesson.liked")` walks
 * messages → lesson → liked and finds nothing. Every screen rendered the raw
 * key, and nothing caught it because nothing resolved a label the way
 * next-intl does. So this resolves them that way.
 */

type Messages = Record<string, unknown>;

/** Splits on dots and walks, exactly as next-intl does. */
function resolve(catalogue: Messages, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (node, segment) =>
        node && typeof node === "object"
          ? (node as Messages)[segment]
          : undefined,
      catalogue,
    );
}

/**
 * A translator that takes its key as a plain string.
 *
 * The app's catalogue is typed, so `t` normally accepts only the literal keys
 * next-intl found in it — which is exactly the guarantee this file exists to
 * check independently. Addressing the keys as data keeps the test honest: it
 * resolves what is in the JSON, not what the type says should be.
 */
function translatorFor(locale: "en" | "ar", catalogue: Messages) {
  return createTranslator({
    locale,
    messages: catalogue as never,
    namespace: "notifications.messages" as never,
  }) as unknown as (key: string, values: Record<string, unknown>) => string;
}

const CATALOGUES: [string, Messages][] = [
  ["en", en as Messages],
  ["ar", ar as Messages],
];

describe("notification copy", () => {
  it.each(CATALOGUES)(
    "%s has a message for every type",
    (_locale, catalogue) => {
      for (const type of NOTIFICATION_TYPES) {
        const message = resolve(catalogue, `notifications.messages.${type}`);
        expect(typeof message, type).toBe("string");
        expect((message as string).length).toBeGreaterThan(0);
      }
    },
  );

  it.each(CATALOGUES)(
    "%s has a preference label for every type",
    (_locale, catalogue) => {
      for (const type of NOTIFICATION_TYPES) {
        const label = resolve(
          catalogue,
          `notifications.preferences.types.${type}`,
        );
        expect(typeof label, type).toBe("string");
      }
    },
  );

  it("uses ICU plurals where several people can be involved", () => {
    // A sentence assembled in code with an `if` gets Arabic wrong in four of
    // its six plural categories. This is why nothing user-facing is stored.
    for (const type of ["lesson.liked", "comment.liked"] as const) {
      for (const [locale, catalogue] of CATALOGUES) {
        const message = resolve(
          catalogue,
          `notifications.messages.${type}`,
        ) as string;
        expect(message, `${locale} ${type}`).toContain("plural");
      }
    }
  });

  it("gives Arabic the plural categories it actually has", () => {
    // English has two; Arabic has six. A catalogue that only supplied one and
    // other would read as broken grammar to half the audience.
    const message = resolve(
      ar as Messages,
      "notifications.messages.comment.liked",
    ) as string;

    for (const category of ["one", "two", "few", "many", "other"]) {
      expect(message, category).toContain(`${category} {`);
    }
  });

  it("counts the OTHER people, not everybody twice", () => {
    // "Sara and 4 others" from four distinct likers claims five people. ICU's
    // `offset:1` is what makes the actor named in the sentence not also one of
    // the others — and it picks the plural category from the remainder, which
    // is the number actually printed.
    const t = translatorFor("en", en as Messages);

    expect(t("lesson.liked", { actor: "Sara", count: 1 })).toBe(
      "Sara liked your lesson",
    );
    expect(t("lesson.liked", { actor: "Sara", count: 2 })).toBe(
      "Sara and 1 other liked your lesson",
    );
    expect(t("lesson.liked", { actor: "Sara", count: 4 })).toBe(
      "Sara and 3 others liked your lesson",
    );
  });

  it("picks the Arabic form from the remainder, not the total", () => {
    // Three likers is Sara plus TWO others, and two is its own category in
    // Arabic. Choosing on the total would render the dual form for three
    // people and the plural for two — wrong in both directions.
    const t = translatorFor("ar", ar as Messages);

    expect(t("comment.liked", { actor: "سارة", count: 1 })).toBe(
      "أعجب سارة بتعليقك",
    );
    expect(t("comment.liked", { actor: "سارة", count: 2 })).toContain(
      "وشخص آخر",
    );
    expect(t("comment.liked", { actor: "سارة", count: 3 })).toContain(
      "وشخصان آخران",
    );
    expect(t("comment.liked", { actor: "سارة", count: 5 })).toContain(
      "و4 آخرين",
    );
  });

  it("stores no key with a dot in it, which would be unreachable", () => {
    // The bug this whole file exists for.
    const walk = (node: unknown, path: string[]): void => {
      if (!node || typeof node !== "object") return;
      for (const [key, value] of Object.entries(node as Messages)) {
        expect(key, [...path, key].join(".")).not.toContain(".");
        walk(value, [...path, key]);
      }
    };

    for (const [locale, catalogue] of CATALOGUES) {
      walk((catalogue as Messages).notifications, [locale, "notifications"]);
    }
  });
});
