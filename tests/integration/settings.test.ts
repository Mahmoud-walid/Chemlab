import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";

import { connect, seedUrl, type SeedDatabase } from "@/db/seed/connect";
import * as schema from "@/db/schema";
import { getSettings, getSetting, clientSettings } from "@/lib/settings/get";
import { SETTINGS, settingDefinition } from "@/lib/settings/registry";

/**
 * The settings read path, against real Postgres.
 *
 * The claims worth proving here: a database with no rows still serves a
 * working configuration, a stored value that no longer satisfies its schema is
 * not served, and a row for a key the registry has forgotten is left alone
 * rather than deleted.
 *
 * `getSettings` is wrapped in React's `cache()`, which is a no-op outside a
 * request — so each call here really does re-read, which is what these tests
 * need.
 */

let db: SeedDatabase;
let close: () => Promise<void>;

beforeAll(() => {
  const url = seedUrl();
  if (!url) throw new Error("no database URL");
  ({ db, close } = connect(url));
});

afterAll(async () => {
  await close?.();
});

afterEach(async () => {
  // A settings table with leftovers changes what every later test reads.
  await db.delete(schema.settings);
});

describe("with no rows at all", () => {
  it("serves every registry default", async () => {
    // The criterion: a fresh database boots and serves the app with nothing
    // seeded. A settings table that had to be populated first would make
    // "deploy" mean "deploy and then remember to seed".
    const resolved = await getSettings();
    for (const definition of SETTINGS) {
      expect(resolved[definition.key]?.value, definition.key).toEqual(
        definition.default,
      );
    }
  });

  it("reports no updatedAt, which is how the form knows there is no row", async () => {
    const resolved = await getSettings();
    expect(resolved["general.siteName"]?.updatedAt).toBeNull();
  });
});

describe("with a stored row", () => {
  it("serves the stored value instead of the default", async () => {
    await db
      .insert(schema.settings)
      .values({ key: "general.siteName", value: "Chemlab Academy" });

    expect(await getSetting<string>("general.siteName")).toBe(
      "Chemlab Academy",
    );
  });

  it("keeps the defaults for every key that has no row", async () => {
    await db
      .insert(schema.settings)
      .values({ key: "general.siteName", value: "Chemlab Academy" });

    const resolved = await getSettings();
    expect(resolved["features.commentsEnabled"]?.value).toBe(true);
    expect(resolved["features.commentsEnabled"]?.updatedAt).toBeNull();
  });

  it("round-trips a boolean as a boolean, not as a string", async () => {
    // jsonb rather than text is why this holds: a text column would hand back
    // "false", which is truthy.
    await db
      .insert(schema.settings)
      .values({ key: "features.registrationOpen", value: false });

    expect(await getSetting<boolean>("features.registrationOpen")).toBe(false);
  });

  it("round-trips a null for a cleared optional field", async () => {
    await db
      .insert(schema.settings)
      .values({ key: "general.contactEmail", value: null });

    expect(await getSetting<string | null>("general.contactEmail")).toBeNull();
  });
});

describe("the slice-2 value shapes", () => {
  it("round-trips a list as a list", async () => {
    await db
      .insert(schema.settings)
      .values({ key: "localization.offeredLocales", value: ["en"] });

    expect(await getSetting<string[]>("localization.offeredLocales")).toEqual([
      "en",
    ]);
  });

  it("round-trips a number as a number", async () => {
    await db
      .insert(schema.settings)
      .values({ key: "content.lessonsPerPage", value: 24 });

    expect(await getSetting<number>("content.lessonsPerPage")).toBe(24);
  });

  it("repairs a number that was stored as a string", async () => {
    // How one gets there: a row written before the schema learned to coerce.
    // Serving "24" where a number is expected makes `perPage - 1` produce
    // "231", so the read path converts rather than falling back.
    await db
      .insert(schema.settings)
      .values({ key: "content.lessonsPerPage", value: "24" });

    expect(await getSetting<number>("content.lessonsPerPage")).toBe(24);
  });

  it("falls back rather than serving a list with an unknown member", async () => {
    await db
      .insert(schema.settings)
      .values({ key: "security.allowedOAuthProviders", value: ["github"] });

    expect(
      await getSetting<string[]>("security.allowedOAuthProviders"),
    ).toEqual(["google"]);
  });

  it("keeps every security and notification key off the client payload", async () => {
    // Not secrets — rate limits and notification defaults simply have no
    // reader in the browser, and everything shipped there is shipped on every
    // page.
    await db.insert(schema.settings).values({
      key: "security.authAttemptsPerWindow",
      value: 3,
    });

    const client = await clientSettings();
    expect(Object.hasOwn(client, "security.authAttemptsPerWindow")).toBe(false);
    expect(Object.hasOwn(client, "notifications.weeklyDigest")).toBe(false);
  });
});

describe("a value the schema no longer accepts", () => {
  it("falls back to the default rather than serving it", async () => {
    // How this happens: a schema is tightened after a row was written. Serving
    // the stored value would push a value through the app that the settings
    // form itself would refuse to save.
    await db
      .insert(schema.settings)
      .values({ key: "general.siteName", value: "" });

    expect(await getSetting<string>("general.siteName")).toBe("Chemlab");
  });

  it("falls back for a value of the wrong type entirely", async () => {
    await db
      .insert(schema.settings)
      .values({ key: "features.commentsEnabled", value: "yes" });

    expect(await getSetting<boolean>("features.commentsEnabled")).toBe(true);
  });
});

describe("a row for a key the registry does not declare", () => {
  it("is ignored, not served and not deleted", async () => {
    // The key may come back — a section rolled out, withdrawn and rolled out
    // again. A settings table is not the place to lose configuration quietly.
    await db
      .insert(schema.settings)
      .values({ key: "general.removedSetting", value: "kept" });

    const resolved = await getSettings();
    expect(resolved["general.removedSetting"]).toBeUndefined();

    const [row] = await db
      .select()
      .from(schema.settings)
      .where(eq(schema.settings.key, "general.removedSetting"));
    expect(row?.value).toBe("kept");
  });
});

describe("clientSettings", () => {
  it("returns only what the registry marks client-safe", async () => {
    const client = await clientSettings();
    const unsafe = SETTINGS.filter((setting) => !setting.clientSafe);
    for (const setting of unsafe) {
      expect(client[setting.key], setting.key).toBeUndefined();
    }
    for (const setting of SETTINGS.filter((s) => s.clientSafe)) {
      expect(Object.hasOwn(client, setting.key), setting.key).toBe(true);
    }
  });
});

describe("optimistic concurrency", () => {
  it("moves updatedAt on every write, so a stale form can be detected", async () => {
    await db
      .insert(schema.settings)
      .values({ key: "general.siteName", value: "First" });
    const first = (await getSettings())["general.siteName"]!.updatedAt!;

    await new Promise((resolve) => setTimeout(resolve, 10));
    await db
      .update(schema.settings)
      .set({ value: "Second", updatedAt: new Date() })
      .where(eq(schema.settings.key, "general.siteName"));

    const second = (await getSettings())["general.siteName"]!.updatedAt!;
    expect(second.getTime()).toBeGreaterThan(first.getTime());
  });
});

describe("the registry's permissions", () => {
  it("names a distinct permission per key that the write action can resolve", async () => {
    // The security property: the write action asks the REGISTRY what
    // permission a key needs, never the section the client claims. This
    // asserts every key has an answer to give.
    for (const definition of SETTINGS) {
      expect(settingDefinition(definition.key)?.permission).toBe(
        definition.permission,
      );
    }
    // And a key nobody declared has none, so it can only be refused.
    expect(settingDefinition("security.masterPassword")).toBeUndefined();
  });
});

describe("cleanup", () => {
  it("leaves no rows behind for the next test", async () => {
    const rows = await db
      .select()
      .from(schema.settings)
      .where(
        inArray(
          schema.settings.key,
          SETTINGS.map((s) => s.key),
        ),
      );
    expect(rows).toEqual([]);
  });
});
