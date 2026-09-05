"use server";

import { revalidatePath } from "next/cache";
import { inArray } from "drizzle-orm";

import { getDb } from "@/db/client";
import { settings } from "@/db/schema/settings";
import { auditLog } from "@/db/schema/rbac";
import { recordActivity } from "@/lib/activity/record";
import { requirePermission } from "@/lib/authz";
import { settingDefinition } from "@/lib/settings/registry";

export interface SettingsSaveResult {
  ok: boolean;
  /** Key-keyed messages, so the form can put each one where it belongs. */
  errors?: Record<string, string>;
  problem?: string;
  /** Set when somebody else changed a key first. */
  conflict?: { key: string };
}

export interface SettingSubmission {
  key: string;
  value: unknown;
  /**
   * What the form was rendered from. `null` means "there was no row". Compared
   * on write so a stale tab reports a conflict instead of clobbering.
   */
  seenAt: string | null;
}

/**
 * Saves changed settings.
 *
 * Two things here are the whole point of the design:
 *
 * 1. **The permission comes from the registry entry of each key**, not from a
 *    section the client names. A request that submits a `security.*` key while
 *    claiming to be a general-section save must be checked as a security
 *    write, or the section argument becomes the authorization.
 *
 * 2. **One transaction over every changed key.** A partial write leaves the
 *    platform in a configuration nobody chose — half a section applied, the
 *    rest refused — and there is no obvious way back from it.
 */
export async function saveSettings(
  submissions: SettingSubmission[],
): Promise<SettingsSaveResult> {
  if (submissions.length === 0) return { ok: true };

  const errors: Record<string, string> = {};
  const parsed: { key: string; value: unknown; seenAt: string | null }[] = [];

  for (const submission of submissions) {
    const definition = settingDefinition(submission.key);
    if (!definition) {
      // An unknown key is not a validation failure to show on a field — there
      // is no field. It is a request that did not come from this form.
      return { ok: false, problem: "That setting does not exist." };
    }

    // Per key, before anything is read or written. `requirePermission` throws,
    // so a caller lacking it never reaches the transaction.
    await requirePermission(definition.permission);

    const result = definition.schema.safeParse(submission.value);
    if (!result.success) {
      errors[submission.key] =
        result.error.issues[0]?.message ?? "That value is not allowed.";
      continue;
    }

    parsed.push({
      key: submission.key,
      value: result.data,
      seenAt: submission.seenAt,
    });
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const actor = await requirePermission("setting:read");
  const db = getDb();
  const keys = parsed.map((entry) => entry.key);

  const existing = await db
    .select()
    .from(settings)
    .where(inArray(settings.key, keys));
  const bySeenKey = new Map(existing.map((row) => [row.key, row]));

  // Conflict detection before the transaction: reporting "somebody changed
  // this first" is more useful than a partial refusal halfway through.
  for (const entry of parsed) {
    const current = bySeenKey.get(entry.key);
    const currentStamp = current ? current.updatedAt.toISOString() : null;
    if (currentStamp !== entry.seenAt) {
      return { ok: false, conflict: { key: entry.key } };
    }
  }

  const changed: { key: string; from: unknown; to: unknown }[] = [];

  await db.transaction(async (tx) => {
    for (const entry of parsed) {
      const current = bySeenKey.get(entry.key);
      const from = current ? current.value : null;

      // Unchanged values are skipped rather than rewritten: a save that
      // touches every key would put a change event on each of them and make
      // the history unreadable.
      if (JSON.stringify(from) === JSON.stringify(entry.value)) continue;

      await tx
        .insert(settings)
        .values({
          key: entry.key,
          value: entry.value,
          updatedBy: actor.userId,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: settings.key,
          set: {
            value: entry.value,
            updatedBy: actor.userId,
            updatedAt: new Date(),
          },
        });

      changed.push({ key: entry.key, from, to: entry.value });

      await tx.insert(auditLog).values({
        actorId: actor.userId,
        action: "setting.update",
        targetType: "setting",
        targetId: entry.key,
        before: { value: from },
        after: { value: entry.value },
      });
    }
  });

  // One event per key, so a change to one setting is greppable on its own
  // rather than buried in a bundle naming five.
  for (const change of changed) {
    await recordActivity({
      verb: "admin.settings_changed",
      objectType: "setting",
      objectId: change.key,
      metadata: { key: change.key, from: change.from, to: change.to },
    });
  }

  if (changed.length > 0) {
    revalidatePath("/admin/settings");
    // The site name and description are rendered into every page's metadata,
    // so a change to them has to reach every route, not just this one.
    revalidatePath("/", "layout");
  }

  return { ok: true };
}
