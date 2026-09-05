import { z } from "zod";

import { NOTIFICATION_TYPES, type NotificationType } from "./types";
import type { Preferences } from "./rules";

/**
 * What a person is allowed to change about their own notifications.
 *
 * Separate from `Preferences` (what the rules read) on purpose: this is the
 * WIRE shape, and it is a patch — a settings form that sent the whole object
 * would silently overwrite a field the page was rendered before it changed.
 * Every key is optional and only the ones present are written.
 *
 * Pure, so every rejection can be tested without a request or a database.
 */

/** Minutes since local midnight. 1440 is not a time; 0 is midnight. */
const minuteOfDay = z.number().int().min(0).max(1439);

/**
 * An IANA zone, checked by asking ICU rather than against a list.
 *
 * A list goes stale — zones are added and renamed — and a wrong zone is not a
 * cosmetic problem here: quiet hours are evaluated in it, so an unrecognised
 * one would silence somebody at the wrong hours in a way nothing surfaces.
 */
export function isValidTimezone(value: string): boolean {
  if (value.length === 0 || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/**
 * `partialRecord`, not `record`.
 *
 * `z.record` over an enum requires EVERY key — which would make a patch
 * carrying one switch invalid, and force the client to send the whole object,
 * which is exactly the overwrite this shape exists to avoid.
 *
 * An unknown key is still rejected rather than dropped: it means the client
 * and the catalogue disagree, and silently discarding it would look like the
 * switch did nothing.
 */
const categories = z.partialRecord(z.enum(NOTIFICATION_TYPES), z.boolean());

export const preferencesPatchSchema = z
  .object({
    categories: categories.optional(),
    pushEnabled: z.boolean().optional(),
    /** ISO 8601, or null to clear the mute. */
    mutedUntil: z.union([z.string().datetime(), z.null()]).optional(),
    quietHoursStart: z.union([minuteOfDay, z.null()]).optional(),
    quietHoursEnd: z.union([minuteOfDay, z.null()]).optional(),
    timezone: z.string().refine(isValidTimezone, "unknown timezone").optional(),
  })
  .strict()
  .refine(
    // Both ends or neither. One end alone cannot describe a window, and the
    // half-set state would read as "quiet hours off" while looking set in the
    // form — the kind of disagreement nobody reports because it looks like
    // their own mistake.
    (patch) =>
      (patch.quietHoursStart === undefined) ===
        (patch.quietHoursEnd === undefined) ||
      patch.quietHoursStart === null ||
      patch.quietHoursEnd === null,
    { message: "set both ends of quiet hours, or neither" },
  );

export type PreferencesPatch = z.infer<typeof preferencesPatchSchema>;

/** The stored shape, for the columns the patch actually touches. */
export interface PreferencesUpdate {
  categories?: Partial<Record<NotificationType, boolean>>;
  pushEnabled?: boolean;
  mutedUntil?: Date | null;
  quietHoursStart?: number | null;
  quietHoursEnd?: number | null;
  timezone?: string;
}

/**
 * Applies a patch to the categories a person already has.
 *
 * Merged rather than replaced, for the same reason the patch exists: two tabs
 * open on the settings page must not have the later save undo the earlier
 * one's unrelated switch.
 */
export function mergeCategories(
  current: Partial<Record<NotificationType, boolean>>,
  patch: Partial<Record<NotificationType, boolean>> | undefined,
): Partial<Record<NotificationType, boolean>> {
  if (!patch) return current;
  return { ...current, ...patch };
}

/** Turns a validated patch into the columns to write. */
export function toUpdate(
  patch: PreferencesPatch,
  current: Preferences,
): PreferencesUpdate {
  const update: PreferencesUpdate = {};

  if (patch.categories) {
    update.categories = mergeCategories(current.categories, patch.categories);
  }
  if (patch.pushEnabled !== undefined) update.pushEnabled = patch.pushEnabled;
  if (patch.mutedUntil !== undefined) {
    update.mutedUntil = patch.mutedUntil ? new Date(patch.mutedUntil) : null;
  }
  if (patch.quietHoursStart !== undefined) {
    update.quietHoursStart = patch.quietHoursStart;
  }
  if (patch.quietHoursEnd !== undefined) {
    update.quietHoursEnd = patch.quietHoursEnd;
  }
  if (patch.timezone !== undefined) update.timezone = patch.timezone;

  return update;
}
