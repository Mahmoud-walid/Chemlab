import { z } from "zod";

/**
 * Validation for the element editor, shared by the form and the server action.
 *
 * The form's copy is for the person typing. The server's copy is the one that
 * decides, because a client can post anything.
 */

/**
 * An optional number from a form field.
 *
 * Load-bearing: the source data has `null` for `color`, `boil`, `density` and
 * others, and an empty input must round-trip back to `null`. Coercing to `0`
 * would turn "we do not know the boiling point" into "it boils at zero
 * kelvin", which is a factual claim nobody made — and one that would then be
 * charted.
 */
const optionalNumber = z
  .union([z.string(), z.number(), z.null(), z.undefined()])
  .transform((value) => {
    if (value === null || value === undefined) return null;
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    const trimmed = value.trim();
    if (trimmed === "") return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : Number.NaN;
  })
  .refine((value) => value === null || !Number.isNaN(value), {
    message: "Enter a number, or leave it empty if it is not known.",
  });

/** A required number: same parsing, but empty is an error rather than null. */
const requiredNumber = (message: string) =>
  optionalNumber.refine((value): value is number => value !== null, {
    message,
  });

/** Text that means "unknown" when blank, rather than an empty string. */
const optionalText = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((value) => {
    const trimmed = (value ?? "").trim();
    return trimmed === "" ? null : trimmed;
  });

/**
 * A whitespace- or comma-separated list of numbers.
 *
 * `shells` and `ionization_energies` are ordered vectors, and an operator
 * types them as "2, 8, 1". Order is preserved exactly: these are positional —
 * the third ionization energy is the third one — so sorting or de-duplicating
 * would corrupt the data while looking tidier.
 */
const numberList = z
  .union([z.string(), z.array(z.number()), z.undefined(), z.null()])
  .transform((value) => {
    if (Array.isArray(value)) return value;
    const raw = (value ?? "").trim();
    if (raw === "") return [];
    return raw
      .split(/[\s,]+/)
      .filter(Boolean)
      .map((part) => Number(part));
  })
  .refine((values) => values.every((value) => Number.isFinite(value)), {
    message: "Use numbers separated by commas or spaces.",
  });

export const elementEditSchema = z.object({
  // The atomic number is the natural key and is not editable: the periodic
  // table is closed at 119, and renumbering an element would silently
  // re-point every link and every seeded row that references it.
  symbol: z
    .string()
    .trim()
    .min(1, { message: "Enter a symbol." })
    .max(3, { message: "Symbols are at most three characters." })
    .regex(/^[A-Z][a-z]{0,2}$/, {
      message: "A symbol is a capital letter, then up to two lowercase.",
    }),
  name: z.string().trim().min(1, { message: "Enter a name." }).max(80),
  category: z.string().trim().min(1, { message: "Enter a category." }).max(80),
  phase: z.string().trim().min(1, { message: "Enter a phase." }).max(20),

  atomicMass: requiredNumber("Enter the atomic mass."),
  period: requiredNumber("Enter the period."),
  xpos: requiredNumber("Enter the column on the table."),
  ypos: requiredNumber("Enter the row on the table."),

  density: optionalNumber,
  melt: optionalNumber,
  boil: optionalNumber,
  molarHeat: optionalNumber,
  electronAffinity: optionalNumber,
  electronegativityPauling: optionalNumber,

  electronConfiguration: z.string().trim().min(1, {
    message: "Enter the electron configuration.",
  }),
  electronConfigurationSemantic: z.string().trim().min(1, {
    message: "Enter the semantic electron configuration.",
  }),
  shells: numberList,
  ionizationEnergies: numberList,

  summary: z.string().trim().min(1, { message: "Enter a summary." }),
  source: z.string().trim().min(1, { message: "Enter a source." }),
  appearance: optionalText,
  color: optionalText,
  spectralImg: optionalText,
  discoveredBy: optionalText,
  namedBy: optionalText,
});

export type ElementEditInput = z.infer<typeof elementEditSchema>;

/**
 * Plausibility checks, separate from shape checks.
 *
 * These are warnings a domain expert would raise, not syntax: a negative
 * atomic mass is not a typo the field type can catch. Kept apart from the
 * schema so the messages can say what is implausible rather than what is
 * malformed.
 */
export function implausibilities(input: ElementEditInput): string[] {
  const problems: string[] = [];

  if (input.atomicMass <= 0) problems.push("Atomic mass must be above zero.");
  if (input.period < 1 || input.period > 8) {
    problems.push("Period is between 1 and 8.");
  }
  if (input.xpos < 1 || input.xpos > 18) {
    problems.push("Column is between 1 and 18 on the periodic table.");
  }
  if (input.ypos < 1 || input.ypos > 10) {
    problems.push("Row is between 1 and 10 on the periodic table.");
  }
  if (input.shells.length === 0) {
    problems.push("An element has at least one electron shell.");
  }
  if (input.shells.some((shell) => shell <= 0 || !Number.isInteger(shell))) {
    problems.push("Shell counts are whole numbers above zero.");
  }
  if (input.ionizationEnergies.some((energy) => energy <= 0)) {
    problems.push("Ionization energies are above zero.");
  }
  // Each successive electron is harder to remove than the last, so the series
  // only ever rises. A drop is a transcription error.
  const energies = input.ionizationEnergies;
  for (let i = 1; i < energies.length; i++) {
    if (energies[i]! <= energies[i - 1]!) {
      problems.push(
        `Ionization energies should increase; entry ${i + 1} is not above entry ${i}.`,
      );
      break;
    }
  }
  for (const [label, value] of [
    ["Melting point", input.melt],
    ["Boiling point", input.boil],
    ["Density", input.density],
  ] as const) {
    if (value !== null && value < 0) {
      problems.push(`${label} cannot be negative.`);
    }
  }
  if (input.melt !== null && input.boil !== null && input.boil < input.melt) {
    problems.push("The boiling point is below the melting point.");
  }

  return problems;
}
