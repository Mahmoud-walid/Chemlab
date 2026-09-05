import { SETTINGS, settingDefinition } from "./registry";

/**
 * Rules that span more than one key.
 *
 * A zod schema sees one value. "The default language must be one of the
 * offered languages" needs both, and needs the values that are NOT being
 * submitted too — a save of the Localisation tab alone can still remove the
 * language that the General tab's default points at.
 *
 * So this takes the FULL resolved configuration as it would be after the
 * write, not just the submission, and is pure: no database, no environment,
 * so both the form and a test can run it.
 */

export interface CrossKeyProblem {
  /** The key whose field should carry the message. */
  key: string;
  message: string;
}

/** Merges a submission over the current values, giving the post-write state. */
export function projectSettings(
  current: Record<string, unknown>,
  submitted: { key: string; value: unknown }[],
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...current };
  for (const entry of submitted) {
    // Only keys the registry declares — a submission is not allowed to invent
    // one and have it participate in a constraint.
    if (settingDefinition(entry.key)) next[entry.key] = entry.value;
  }
  for (const setting of SETTINGS) {
    if (!(setting.key in next)) next[setting.key] = setting.default;
  }
  return next;
}

function asLocaleList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v) => typeof v === "string") : [];
}

/**
 * Every cross-key rule, checked against the post-write configuration.
 *
 * Returns problems rather than throwing, so the form can put each message on
 * the field that has to change, and so a caller reports all of them at once.
 */
export function crossKeyProblems(
  projected: Record<string, unknown>,
): CrossKeyProblem[] {
  const problems: CrossKeyProblem[] = [];

  const offered = asLocaleList(projected["localization.offeredLocales"]);
  const defaultLocale = projected["general.defaultLocale"];

  // The default locale is what an unrecognised visitor gets. Dropping it from
  // the offered list leaves the site serving a language it claims not to
  // offer — reported against the list, because the list is what changed.
  if (
    typeof defaultLocale === "string" &&
    offered.length > 0 &&
    !offered.includes(defaultLocale)
  ) {
    problems.push({
      key: "localization.offeredLocales",
      message: `The default language (${defaultLocale}) has to stay in this list.`,
    });
  }

  // `localization.fallbackLocale` deliberately has NO rule tying it to the
  // offered list. It is where next-intl looks for a message the served
  // language is missing, and every locale's catalogue exists at build time
  // whether or not the language is offered — so a fallback outside the list
  // still resolves. Adding the rule would mean three fields to change to go
  // Arabic-only, in exchange for preventing nothing.

  return problems;
}
