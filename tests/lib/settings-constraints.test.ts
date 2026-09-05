import { describe, expect, it } from "vitest";

import { crossKeyProblems, projectSettings } from "@/lib/settings/constraints";
import { defaultSettings } from "@/lib/settings/registry";

const base = () => defaultSettings();

describe("projecting a submission over the current configuration", () => {
  it("applies the submitted keys and leaves the rest alone", () => {
    const projected = projectSettings(base(), [
      { key: "general.siteName", value: "Kimia" },
    ]);
    expect(projected["general.siteName"]).toBe("Kimia");
    expect(projected["general.defaultLocale"]).toBe("en");
  });

  it("fills a key the caller never had with its default", () => {
    // The current values come from the database, where a missing row is the
    // normal case. A constraint must still see a value for that key.
    const projected = projectSettings({}, []);
    expect(projected["localization.offeredLocales"]).toEqual(["en", "ar"]);
  });

  it("ignores a key the registry does not declare", () => {
    // A submission is not allowed to invent a key and have it take part in a
    // rule — or to shadow one by name.
    const projected = projectSettings(base(), [
      { key: "general.siteNam", value: "typo" },
      { key: "__proto__", value: "no" },
    ]);
    expect(projected["general.siteNam"]).toBeUndefined();
    expect(Object.hasOwn(projected, "__proto__")).toBe(false);
  });
});

describe("cross-key rules", () => {
  it("accepts the shipped defaults", () => {
    expect(crossKeyProblems(base())).toEqual([]);
  });

  it("refuses to drop the default language from the offered list", () => {
    // The reason this rule cannot be a zod schema: neither key can see the
    // other, and the submission that breaks it need not contain both.
    const projected = projectSettings(base(), [
      { key: "localization.offeredLocales", value: ["ar"] },
    ]);
    const problems = crossKeyProblems(projected);
    expect(problems.map((problem) => problem.key)).toContain(
      "localization.offeredLocales",
    );
    expect(problems[0].message).toContain("en");
  });

  it("accepts dropping a language once the default moved off it", () => {
    const projected = projectSettings(base(), [
      { key: "general.defaultLocale", value: "ar" },
      { key: "localization.offeredLocales", value: ["ar"] },
    ]);
    expect(crossKeyProblems(projected)).toEqual([]);
  });

  it("catches the same break from the other direction", () => {
    // Changing the DEFAULT to a language that is not offered is the same
    // inconsistency arriving through a different tab.
    const projected = projectSettings(base(), [
      { key: "localization.offeredLocales", value: ["en"] },
      { key: "general.defaultLocale", value: "ar" },
    ]);
    expect(crossKeyProblems(projected)).not.toEqual([]);
  });

  it("leaves the fallback language alone when it is not offered", () => {
    // Not an oversight. Every locale's message catalogue exists at build time
    // whether or not the language is offered to visitors, so a fallback
    // outside the list still resolves — and the rule would cost a third field
    // to change to go Arabic-only in exchange for preventing nothing.
    const projected = projectSettings(base(), [
      { key: "general.defaultLocale", value: "ar" },
      { key: "localization.offeredLocales", value: ["ar"] },
      { key: "localization.fallbackLocale", value: "en" },
    ]);
    expect(crossKeyProblems(projected)).toEqual([]);
  });

  it("reports a break caused by a key the submission does not contain", () => {
    // The Languages tab submits only its own keys. The rule it breaks belongs
    // to General, which is not on screen — so the check has to run against
    // the merged configuration, not against the submission.
    const projected = projectSettings(base(), [
      { key: "localization.offeredLocales", value: ["ar"] },
    ]);
    const problems = crossKeyProblems(projected);
    expect(problems).toHaveLength(1);
    expect(problems[0].message).toContain("en");
  });
});
