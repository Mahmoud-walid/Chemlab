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

/**
 * ICU placeholders, e.g. {count} or {value, number, percent} -> "value".
 *
 * The name must be followed by `}` or `,`. Without that the plural CASE
 * bodies count as placeholders too — `=0 {No unread notifications}` yields a
 * phantom "No" — and the check then fails whenever two locales word a case
 * differently, which is most of the time. That is a false positive, not a
 * dropped placeholder, and it would train people to edit copy to appease it.
 */
function placeholders(message: string): Set<string> {
  return new Set(
    [...message.matchAll(/\{\s*(\w+)\s*[},]/g)].map((match) => match[1]),
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
      expect(
        [...placeholders(english)].sort(),
        `placeholders differ for ${key}`,
      ).toEqual([...placeholders(arabic)].sort());
    }
  });

  /**
   * Values that are deliberately identical across locales: language endonyms,
   * and the unit symbols and sample glyphs that Arabic chemistry teaching
   * writes in Latin script (kJ/mol, g/cm³, K). Keeping them in the catalogue
   * rather than hard-coding them means a translator can still override them.
   */
  const intentionallyLatin = (key: string) =>
    // A language's own name, wherever it appears. `locale.*` is the public
    // switcher; `admin.settings.locales.*` is the same list in the settings
    // form. A picker that translated its own options would offer an Arabic
    // reader "الإنجليزية" and "العربية", which is worse at the one job it has:
    // letting somebody find the language they read.
    key.startsWith("locale.") ||
    /(^|\.)locales\.[a-z]{2}$/.test(key) ||
    key.startsWith("element.units.") ||
    key === "settings.fontSample" ||
    // "{count}e" — e is the electron symbol, not a word.
    key === "element.electronCount" ||
    // A sample email address. Email local parts and example.com are the same
    // in every locale, and an Arabic-script placeholder would be misleading
    // about what the field accepts.
    key === "auth.emailPlaceholder" ||
    // Sign-in provider names. "Google" is the brand as it appears on the
    // button the visitor is about to press, and Google's own Arabic sign-in
    // flow spells it in Latin script too — transliterating it here would make
    // the two disagree.
    key.startsWith("admin.settings.options.security.allowedOAuthProviders.") ||
    // Git branch names, in a field that takes git branch names. `main` is the
    // branch this repository actually has; an Arabic-script example would
    // name a branch that does not exist, in a field where a pattern matching
    // nothing is the exact failure the validation exists to prevent.
    key === "notifications.ci.branchesPlaceholder";

  it("actually translates — Arabic values are not copies of the English", () => {
    const allowedIdentical = new Set(["locale.en", "locale.ar"]);
    const untranslated = [...enFlat.entries()]
      .filter(([key, value]) => {
        if (allowedIdentical.has(key) || intentionallyLatin(key)) return false;
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
        if (intentionallyLatin(key)) return false;
        // Checked against the raw value: an ICU plural nests its translated
        // sub-messages inside braces, so stripping placeholders first would
        // throw away the very Arabic being looked for.
        if (arabicScript.test(value)) return false;
        // No Arabic — is there any prose here at all, or only placeholders
        // and punctuation? Nested braces are collapsed repeatedly.
        let stripped = value;
        let previous: string;
        do {
          previous = stripped;
          stripped = stripped.replace(/\{[^{}]*\}/g, "");
        } while (stripped !== previous);
        return /\p{L}/u.test(stripped);
      })
      .map(([key]) => key);

    expect(suspicious, "Arabic messages with no Arabic script").toEqual([]);
  });
});
