import "server-only";
import { cache } from "react";

import { getDb } from "@/db/client";
import { hasDatabase } from "@/db/queries/availability";
import { settings } from "@/db/schema/settings";
import { SETTINGS, defaultSettings, settingDefinition } from "./registry";

/**
 * Reading settings. Server-side only, on purpose.
 *
 * There is deliberately no `/api/settings` endpoint. One would invite a client
 * fetch on every page and turn a configuration read into a network round trip
 * — for values that are already in memory on the server. The small client-safe
 * subset is read here and passed down as props.
 *
 * `cache()` dedupes within a request: a layout, a page and three components all
 * asking for the site name issue one query between them.
 */

export interface ResolvedSetting {
  value: unknown;
  /** Null when no row exists and the registry default is being served. */
  updatedAt: Date | null;
}

/**
 * Every setting, with defaults filling the gaps.
 *
 * A missing row is the normal case, not an error: a fresh database has none,
 * and a row appears only where somebody changed something. That is what lets
 * the app boot with nothing seeded.
 *
 * A stored value that no longer satisfies its schema — because the schema was
 * tightened after the row was written — falls back to the default rather than
 * being served. Serving it would push a value through the app that the form
 * itself would refuse to save.
 */
export const getSettings = cache(
  async (): Promise<Record<string, ResolvedSetting>> => {
    const resolved: Record<string, ResolvedSetting> = Object.fromEntries(
      SETTINGS.map((setting) => [
        setting.key,
        { value: setting.default, updatedAt: null },
      ]),
    );

    if (!hasDatabase()) return resolved;

    try {
      const rows = await getDb().select().from(settings);

      for (const row of rows) {
        const definition = settingDefinition(row.key);
        // A row for a key the registry no longer declares is left alone rather
        // than deleted: the key may come back, and a settings table is not the
        // place to lose someone's configuration silently.
        if (!definition) continue;

        const parsed = definition.schema.safeParse(row.value);
        if (!parsed.success) continue;

        resolved[row.key] = { value: parsed.data, updatedAt: row.updatedAt };
      }
    } catch {
      // The database being unreachable must not take the site down for a
      // configuration read. Defaults are a working configuration.
    }

    return resolved;
  },
);

/** One setting's value, typed by its caller. */
export async function getSetting<T>(key: string): Promise<T> {
  const all = await getSettings();
  return all[key]?.value as T;
}

/** Only what is safe to send to a browser. */
export async function clientSettings(): Promise<Record<string, unknown>> {
  const all = await getSettings();
  return Object.fromEntries(
    SETTINGS.filter((setting) => setting.clientSafe).map((setting) => [
      setting.key,
      all[setting.key]?.value,
    ]),
  );
}

export { defaultSettings };
