import { describe, expect, it } from "vitest";

import {
  SECRET_LOOKING,
  SETTINGS,
  SETTING_SECTIONS,
  defaultSettings,
  settingDefinition,
  settingsInSection,
} from "@/lib/settings/registry";
import { isKnownPermission } from "@/lib/authz-core";
import { locales } from "@/i18n/routing";

describe("the settings registry", () => {
  it("has a unique key per setting", () => {
    const keys = SETTINGS.map((setting) => setting.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("names every key as section.name, matching its declared section", () => {
    // The key's prefix is not decoration: the write action groups by section
    // and the form renders by section, so a key whose prefix disagrees with
    // its section would appear under one tab and save under another.
    for (const setting of SETTINGS) {
      expect(setting.key, setting.key).toMatch(/^[a-z]+\.[a-zA-Z]+$/);
      expect(setting.key.split(".")[0], setting.key).toBe(setting.section);
    }
  });

  it("declares a section that exists", () => {
    for (const setting of SETTINGS) {
      expect(SETTING_SECTIONS, setting.key).toContain(setting.section);
    }
  });

  it("guards every setting with a permission that exists", () => {
    // A typo here would not fail: `hasPermission` throws on an unknown name,
    // so the setting would become uneditable rather than unguarded — still a
    // bug, and one that looks like a broken form.
    for (const setting of SETTINGS) {
      expect(isKnownPermission(setting.permission), setting.key).toBe(true);
    }
  });

  it("holds no key that even looks like a secret", () => {
    // This is the assertion that makes recording old and new values in the
    // activity stream safe by construction. Secrets are environment variables.
    for (const setting of SETTINGS) {
      expect(SECRET_LOOKING.test(setting.key), setting.key).toBe(false);
    }
  });

  it("gives every setting a default its own schema accepts", () => {
    // A default the schema rejects means a fresh database serves a value that
    // could never be saved — working until the first edit, then refusing it.
    for (const setting of SETTINGS) {
      const result = setting.schema.safeParse(setting.default);
      expect(result.success, `${setting.key}: ${result.error?.message}`).toBe(
        true,
      );
    }
  });

  it("defaults the locale to one the app actually serves", () => {
    const locale = SETTINGS.find(
      (setting) => setting.key === "general.defaultLocale",
    );
    expect(locales).toContain(locale!.default as string);
  });

  it("looks a setting up by key, and returns nothing for an unknown one", () => {
    expect(settingDefinition("general.siteName")?.section).toBe("general");
    // The guard for anything arriving from a form: an unknown key must not be
    // written, and must not throw either.
    expect(settingDefinition("general.siteNam")).toBeUndefined();
    expect(settingDefinition("__proto__")).toBeUndefined();
  });

  it("groups settings by section without losing any", () => {
    const grouped = SETTING_SECTIONS.flatMap((section) =>
      settingsInSection(section),
    );
    expect(grouped).toHaveLength(SETTINGS.length);
  });

  it("returns a default for every key", () => {
    const defaults = defaultSettings();
    expect(Object.keys(defaults).sort()).toEqual(
      SETTINGS.map((setting) => setting.key).sort(),
    );
  });
});

describe("the schemas", () => {
  const schemaFor = (key: string) => settingDefinition(key)!.schema;

  it("rejects an empty site name", () => {
    expect(schemaFor("general.siteName").safeParse("").success).toBe(false);
    expect(schemaFor("general.siteName").safeParse("   ").success).toBe(false);
  });

  it("trims a site name rather than rejecting whitespace around it", () => {
    expect(schemaFor("general.siteName").parse("  Chemlab  ")).toBe("Chemlab");
  });

  it("treats a cleared optional field as null, not an empty string", () => {
    // An empty string in a column read as "is there a contact address" would
    // answer yes.
    expect(schemaFor("general.contactEmail").parse("")).toBeNull();
    expect(schemaFor("general.supportUrl").parse("")).toBeNull();
  });

  it("rejects a malformed email or URL", () => {
    expect(
      schemaFor("general.contactEmail").safeParse("not-an-email").success,
    ).toBe(false);
    expect(
      schemaFor("general.supportUrl").safeParse("example.com").success,
    ).toBe(false);
  });

  it("rejects a locale the app does not serve", () => {
    expect(schemaFor("general.defaultLocale").safeParse("fr").success).toBe(
      false,
    );
    expect(schemaFor("general.defaultLocale").safeParse("en").success).toBe(
      true,
    );
  });

  it("rejects a non-boolean feature flag", () => {
    // A form posting "false" as a string would otherwise be truthy.
    expect(
      schemaFor("features.commentsEnabled").safeParse("false").success,
    ).toBe(false);
    expect(schemaFor("features.commentsEnabled").safeParse(false).success).toBe(
      true,
    );
  });
});
