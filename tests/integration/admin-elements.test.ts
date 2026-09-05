import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { connect, seedUrl, type SeedDatabase } from "@/db/seed/connect";
import * as schema from "@/db/schema";
import {
  elementEditSchema,
  implausibilities,
} from "@/lib/admin/element-schema";

/**
 * The element editor's round trip, against real Postgres.
 *
 * The acceptance criterion this exists for: editing an element and reading it
 * back must lose nothing — not a null, not the order of a vector. A form that
 * silently turns "unknown boiling point" into zero would look like it worked.
 *
 * The server ACTION itself needs the Next.js runtime, so what is exercised here
 * is the pair that decides what gets written: the same zod schema the action
 * parses with, and the same update it performs.
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

/** The form payload an operator would submit for a row, unchanged. */
function formValuesFor(row: typeof schema.elements.$inferSelect) {
  return {
    symbol: row.symbol,
    name: row.name,
    category: row.category,
    phase: row.phase,
    atomicMass: String(row.atomicMass),
    period: String(row.period),
    xpos: String(row.xpos),
    ypos: String(row.ypos),
    density: row.density === null ? "" : String(row.density),
    melt: row.melt === null ? "" : String(row.melt),
    boil: row.boil === null ? "" : String(row.boil),
    molarHeat: row.molarHeat === null ? "" : String(row.molarHeat),
    electronAffinity:
      row.electronAffinity === null ? "" : String(row.electronAffinity),
    electronegativityPauling:
      row.electronegativityPauling === null
        ? ""
        : String(row.electronegativityPauling),
    electronConfiguration: row.electronConfiguration,
    electronConfigurationSemantic: row.electronConfigurationSemantic,
    shells: row.shells.join(", "),
    ionizationEnergies: row.ionizationEnergies.join(", "),
    summary: row.summary,
    source: row.source,
    appearance: row.appearance ?? "",
    color: row.color ?? "",
    spectralImg: row.spectralImg ?? "",
    discoveredBy: row.discoveredBy ?? "",
    namedBy: row.namedBy ?? "",
  };
}

async function read(atomicNumber: number) {
  const [row] = await db
    .select()
    .from(schema.elements)
    .where(eq(schema.elements.number, atomicNumber));
  return row!;
}

describe("the element editor round trip", () => {
  it("saves Hydrogen unchanged and reads back exactly the seeded row", async () => {
    const before = await read(1);
    const parsed = elementEditSchema.parse(formValuesFor(before));
    expect(implausibilities(parsed)).toEqual([]);

    await db
      .update(schema.elements)
      .set(parsed)
      .where(eq(schema.elements.number, 1));

    const after = await read(1);
    // Every field, not a spot check: this is the criterion.
    for (const key of Object.keys(parsed) as (keyof typeof parsed)[]) {
      expect(after[key as keyof typeof after], key).toEqual(parsed[key]);
    }
    expect(after.shells).toEqual(before.shells);
    expect(after.ionizationEnergies).toEqual(before.ionizationEnergies);
  });

  it("keeps a null measurement null, rather than turning it into zero", async () => {
    // Helium has no melting point in the source data. A zero would be a claim
    // nobody made, and it would then be charted.
    const helium = await read(2);
    const nullable = (["melt", "boil", "density", "color"] as const).filter(
      (key) => helium[key] === null,
    );
    expect(
      nullable.length,
      "expected Helium to have unknown values",
    ).toBeGreaterThan(0);

    const parsed = elementEditSchema.parse(formValuesFor(helium));
    await db
      .update(schema.elements)
      .set(parsed)
      .where(eq(schema.elements.number, 2));

    const after = await read(2);
    for (const key of nullable) {
      expect(after[key], key).toBeNull();
    }
  });

  it("preserves vector order rather than sorting it", async () => {
    // Potassium's shells are 2, 8, 8, 1 — positional. Sorted, they would be a
    // different atom.
    const potassium = await read(19);
    expect(potassium.shells).toEqual([2, 8, 8, 1]);

    const parsed = elementEditSchema.parse(formValuesFor(potassium));
    await db
      .update(schema.elements)
      .set(parsed)
      .where(eq(schema.elements.number, 19));

    expect((await read(19)).shells).toEqual([2, 8, 8, 1]);
  });

  it("applies a real edit and can be put back", async () => {
    const before = await read(26);
    const edited = elementEditSchema.parse({
      ...formValuesFor(before),
      summary: "Edited by the integration suite.",
      melt: "",
    });

    await db
      .update(schema.elements)
      .set(edited)
      .where(eq(schema.elements.number, 26));

    const after = await read(26);
    expect(after.summary).toBe("Edited by the integration suite.");
    expect(after.melt).toBeNull();

    // Restore, so the verifier still passes against data/.
    await db
      .update(schema.elements)
      .set(elementEditSchema.parse(formValuesFor(before)))
      .where(eq(schema.elements.number, 26));

    const restored = await read(26);
    expect(restored.summary).toBe(before.summary);
    expect(restored.melt).toBe(before.melt);
  });
});
