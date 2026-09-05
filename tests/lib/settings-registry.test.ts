import { describe, expect, it } from "vitest";

import {
  OAUTH_PROVIDERS,
  SECRET_LOOKING,
  SETTINGS,
  SETTING_KINDS,
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

  it("declares a kind every renderer knows", () => {
    for (const setting of SETTINGS) {
      expect(SETTING_KINDS, setting.key).toContain(setting.kind);
    }
  });

  it("gives every choosing kind its options, and no others", () => {
    // A select with no options renders an empty dropdown; options on a text
    // field are silently ignored. Both are the kind of mistake that only
    // shows up when somebody opens the tab.
    for (const setting of SETTINGS) {
      const choosing =
        setting.kind === "select" || setting.kind === "multiSelect";
      expect(Boolean(setting.options), setting.key).toBe(choosing);
      if (choosing)
        expect(setting.options!.length, setting.key).toBeGreaterThan(0);
    }
  });

  it("only offers options its own schema accepts", () => {
    for (const setting of SETTINGS) {
      for (const option of setting.options ?? []) {
        const candidate = setting.kind === "multiSelect" ? [option] : option;
        const result = setting.schema.safeParse(candidate);
        expect(result.success, `${setting.key} rejects ${option}`).toBe(true);
      }
    }
  });

  it("guards every security setting with the security permission", () => {
    // The whole point of the split. A security key that slipped back to
    // `setting:update` would be editable by anyone who can rename the site,
    // and nothing on the screen would look different.
    for (const setting of settingsInSection("security")) {
      expect(setting.permission, setting.key).toBe("setting:update_security");
    }
    for (const setting of SETTINGS) {
      if (setting.section === "security") continue;
      expect(setting.permission, setting.key).toBe("setting:update");
    }
  });

  it("keeps every server-side setting out of the browser payload", () => {
    // `clientSafe` is not about secrecy — nothing here is secret. It is about
    // what is worth shipping in every page's payload, and the rate limits and
    // notification defaults are read by the server alone.
    for (const setting of SETTINGS) {
      if (
        setting.section === "security" ||
        setting.section === "notifications"
      ) {
        expect(setting.clientSafe, setting.key).toBe(false);
      }
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

describe("the slice-2 schemas", () => {
  const schemaFor = (key: string) => settingDefinition(key)!.schema;

  it("accepts a number field posted as the string an input holds", () => {
    // A number input posts "12", not 12. Rejecting it would make every
    // numeric field unsaveable, which is exactly the sort of thing that ships.
    expect(schemaFor("content.lessonsPerPage").parse("12")).toBe(12);
    expect(schemaFor("content.lessonsPerPage").parse(12)).toBe(12);
  });

  it("rejects an empty or non-numeric page size rather than reading it as 0", () => {
    expect(schemaFor("content.lessonsPerPage").safeParse("").success).toBe(
      false,
    );
    expect(schemaFor("content.lessonsPerPage").safeParse("abc").success).toBe(
      false,
    );
    expect(schemaFor("content.lessonsPerPage").safeParse("4.5").success).toBe(
      false,
    );
  });

  it("keeps page sizes inside a range a page can actually render", () => {
    expect(schemaFor("content.lessonsPerPage").safeParse(3).success).toBe(
      false,
    );
    expect(schemaFor("content.lessonsPerPage").safeParse(61).success).toBe(
      false,
    );
  });

  it("treats 0 as no time limit, but refuses a one-second exam", () => {
    const schema = schemaFor("content.defaultExamTimeLimitSeconds");
    expect(schema.safeParse(0).success).toBe(true);
    expect(schema.safeParse(59).success).toBe(false);
    expect(schema.safeParse(60).success).toBe(true);
  });

  it("treats 0 attempts as unlimited rather than as none", () => {
    expect(schemaFor("content.defaultMaxAttempts").safeParse(0).success).toBe(
      true,
    );
  });

  it("rejects an OAuth provider the app has no client for", () => {
    const schema = schemaFor("security.allowedOAuthProviders");
    expect(schema.safeParse(["google"]).success).toBe(true);
    expect(schema.safeParse(["github"]).success).toBe(false);
    // An empty list is valid: it means email and password only.
    expect(schema.safeParse([]).success).toBe(true);
  });

  it("offers exactly the providers the app knows how to speak to", () => {
    expect(
      settingDefinition("security.allowedOAuthProviders")!.options,
    ).toEqual(OAUTH_PROVIDERS);
  });

  it("refuses to offer no language at all", () => {
    const schema = schemaFor("localization.offeredLocales");
    expect(schema.safeParse([]).success).toBe(false);
    expect(schema.safeParse(["en"]).success).toBe(true);
    expect(schema.safeParse(["en", "en"]).success).toBe(false);
    expect(schema.safeParse(["en", "fr"]).success).toBe(false);
  });

  it("keeps a rate limit from being set to zero requests", () => {
    // A window allowing 0 attempts locks everyone out, including the person
    // who set it — through the settings screen they can no longer sign in to.
    expect(
      schemaFor("security.authAttemptsPerWindow").safeParse(0).success,
    ).toBe(false);
  });
});
