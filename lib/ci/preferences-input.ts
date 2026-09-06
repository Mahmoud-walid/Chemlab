import { z } from "zod";

import type { CiPreferences } from "./policy";

/**
 * What a developer is allowed to change about their own CI alerts.
 *
 * Separate from `CiPreferences` (what the policy reads) on purpose: this is
 * the WIRE shape, and it is a patch. A settings form that sent the whole
 * object would overwrite a field it was rendered before it changed — two tabs
 * open, and the later save silently undoes the earlier one's unrelated switch.
 *
 * Pure, so every rejection can be tested without a request or a database.
 */

/**
 * A branch pattern, in the vocabulary `watchesBranch` actually implements:
 * `*` alone, a `prefix/*`, or a literal name.
 *
 * Validated rather than accepted as free text because the failure is silent
 * in the direction that matters. `feat*` (no slash) and ` main` (a stray
 * space) both parse fine, match nothing, and leave somebody believing they
 * are watching a branch they are not — and the whole point of this feature is
 * to be told when a build breaks.
 */
export function isValidBranchPattern(value: string): boolean {
  if (value === "*") return true;
  const branch = value.endsWith("/*") ? value.slice(0, -2) : value;
  if (branch.length === 0 || branch.length > 200) return false;
  // Git's own refname rules, narrowed: no whitespace, no wildcards left
  // anywhere but the trailing `/*` already stripped above, and none of the
  // characters `git check-ref-format` refuses.
  if (/[\s~^:?*[\\]/.test(branch)) return false;
  if (branch.startsWith("/") || branch.endsWith("/")) return false;
  if (branch.includes("//") || branch.includes("..")) return false;
  if (branch.startsWith("-") || branch.endsWith(".lock")) return false;
  return true;
}

/**
 * At least one, and a ceiling.
 *
 * An empty list is not "every branch" and not "the default" — it is a watch
 * list that matches nothing, which reads on the page as opted in and behaves
 * as opted out. Somebody who wants no alerts turns `enabled` off.
 */
const branches = z
  .array(z.string().refine(isValidBranchPattern, "unknown branch pattern"))
  .min(1, "watch at least one branch, or turn CI alerts off")
  .max(20, "too many branch patterns");

export const ciPreferencesPatchSchema = z
  .object({
    enabled: z.boolean().optional(),
    branches: branches.optional(),
    notifyOnFailure: z.boolean().optional(),
    successPolicy: z.enum(["never", "recovery", "always"]).optional(),
    notifyOnCancelled: z.boolean().optional(),
  })
  .strict();

export type CiPreferencesPatch = z.infer<typeof ciPreferencesPatchSchema>;

/**
 * Turns a validated patch into the columns to write.
 *
 * Duplicate patterns are collapsed, keeping the order they were sent in: two
 * copies of `main` are one watch, and a list that grows every time the form
 * is saved is a bug nobody notices until it hits the ceiling above.
 */
export function toUpdate(patch: CiPreferencesPatch): Partial<CiPreferences> {
  const update: Partial<CiPreferences> = {};

  if (patch.enabled !== undefined) update.enabled = patch.enabled;
  if (patch.branches !== undefined)
    update.branches = [...new Set(patch.branches)];
  if (patch.notifyOnFailure !== undefined) {
    update.notifyOnFailure = patch.notifyOnFailure;
  }
  if (patch.successPolicy !== undefined) {
    update.successPolicy = patch.successPolicy;
  }
  if (patch.notifyOnCancelled !== undefined) {
    update.notifyOnCancelled = patch.notifyOnCancelled;
  }

  return update;
}
