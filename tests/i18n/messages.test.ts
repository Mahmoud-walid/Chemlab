import { describe, expect, it } from "vitest";
import en from "@/messages/en.json";
import ar from "@/messages/ar.json";
import { locales } from "@/i18n/routing";

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") out.set(path, value);
    else for (const [k, v] of flatten(value, path)) out.set(k, v);
  }
  return out;
}

const enFlat = flatten(en as Tree);
const arFlat = flatten(ar as Tree);

/** ICU placeholders, e.g. {count} or {value, number, percent} -> "value". */
function placeholders(message: string): Set<string> {
  return new Set(
    [...message.matchAll(/\{\s*(\w+)/g)].map((match) => match[1]),
  );
}

describe("message catalogues", () => {
  it("covers every configured locale", () => {
    expect([...locales].sort()).toEqual(["ar", "en"]);
  });

  it("has identical key trees in both directions", () => {
    const missingInArabic = [...enFlat.keys()].filter((k) => !arFlat.has(k));
    const extraInArabic = [...arFlat.keys()].filter((k) => !enFlat.has(k));

    expect(missingInArabic, "keys missing from ar.json").toEqual([]);
    expect(extraInArabic, "keys in ar.json with no English source").toEqual([]);
  });

  it("has no empty messages", () => {
    for (const [locale, flat] of [
      ["en", enFlat],
      ["ar", arFlat],
    ] as const) {
      for (const [key, value] of flat) {
        expect(value.trim(), `${locale}: ${key} is empty`).not.toBe("");
      }
    }
  });

  it("keeps the same ICU placeholders in both locales", () => {
    // A dropped placeholder renders a literal "{count}" to the user.
    for (const [key, english] of enFlat) {
      const arabic = arFlat.get(key)!;
      expect([...placeholders(english)].sort(), `placeholders differ for ${key}`)
        .toEqual([...placeholders(arabic)].sort());
    }
  });

  it("actually translates — Arabic values are not copies of the English", () => {
    // Proper nouns and language endonyms legitimately match.
    const allowedIdentical = new Set(["locale.en", "locale.ar"]);
    const untranslated = [...enFlat.entries()]
      .filter(([key, value]) => {
        if (allowedIdentical.has(key)) return false;
        const arabic = arFlat.get(key)!;
        // A message that is only ICU placeholders ("{score} / {total}") is
        // identical in every locale by design and carries no prose.
        const prose = value.replace(/\{[^}]*\}/g, "");
        return arabic === value && /[A-Za-z]{3}/.test(prose);
      })
      .map(([key]) => key);

    expect(untranslated, "these still hold English text").toEqual([]);
  });

  it("writes Arabic in Arabic script", () => {
    const arabicScript = /[؀-ۿ]/;
    const suspicious = [...arFlat.entries()]
      .filter(([key, value]) => {
        if (key.startsWith("locale.")) return false;
        // Messages that are only placeholders or punctuation have no letters.
        const withoutPlaceholders = value.replace(/\{[^}]*\}/g, "").trim();
        if (!/\p{L}/u.test(withoutPlaceholders)) return false;
        return !arabicScript.test(withoutPlaceholders);
      })
      .map(([key]) => key);

    expect(suspicious, "Arabic messages with no Arabic script").toEqual([]);
  });
});
