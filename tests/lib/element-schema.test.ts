import { describe, expect, it } from "vitest";

import {
  elementEditSchema,
  implausibilities,
  type ElementEditInput,
} from "@/lib/admin/element-schema";

const hydrogen = {
  symbol: "H",
  name: "Hydrogen",
  category: "diatomic nonmetal",
  phase: "Gas",
  atomicMass: "1.008",
  period: "1",
  xpos: "1",
  ypos: "1",
  density: "0.08988",
  melt: "13.99",
  boil: "20.271",
  molarHeat: "28.836",
  electronAffinity: "72.769",
  electronegativityPauling: "2.2",
  electronConfiguration: "1s1",
  electronConfigurationSemantic: "1s1",
  shells: "1",
  ionizationEnergies: "1312",
  summary: "Hydrogen is a chemical element.",
  source: "https://en.wikipedia.org/wiki/Hydrogen",
  appearance: "colorless gas",
  color: "",
  spectralImg: "",
  discoveredBy: "Henry Cavendish",
  namedBy: "Antoine Lavoisier",
};

describe("elementEditSchema", () => {
  it("parses a complete element", () => {
    const parsed = elementEditSchema.parse(hydrogen);
    expect(parsed.symbol).toBe("H");
    expect(parsed.atomicMass).toBe(1.008);
    expect(parsed.shells).toEqual([1]);
    expect(parsed.ionizationEnergies).toEqual([1312]);
  });

  it("turns an empty optional number into null, never zero", () => {
    // The source data has nulls for boil, density and colour. A zero here
    // would claim a measurement nobody made — and it would then be charted.
    const parsed = elementEditSchema.parse({
      ...hydrogen,
      density: "",
      melt: "   ",
      boil: null,
      molarHeat: undefined,
    });
    expect(parsed.density).toBeNull();
    expect(parsed.melt).toBeNull();
    expect(parsed.boil).toBeNull();
    expect(parsed.molarHeat).toBeNull();
  });

  it("turns an empty optional text field into null", () => {
    const parsed = elementEditSchema.parse({ ...hydrogen, color: "  " });
    expect(parsed.color).toBeNull();
  });

  it("rejects a value that is not a number", () => {
    expect(
      elementEditSchema.safeParse({ ...hydrogen, density: "quite dense" })
        .success,
    ).toBe(false);
  });

  it("requires the fields that are never null in the data", () => {
    for (const field of ["atomicMass", "period", "xpos", "ypos"]) {
      const result = elementEditSchema.safeParse({ ...hydrogen, [field]: "" });
      expect(result.success, field).toBe(false);
    }
  });

  it("enforces the shape of a chemical symbol", () => {
    for (const symbol of ["h", "HE", "Hell", "1H", ""]) {
      expect(
        elementEditSchema.safeParse({ ...hydrogen, symbol }).success,
        symbol,
      ).toBe(false);
    }
    for (const symbol of ["H", "He", "Uue"]) {
      expect(
        elementEditSchema.safeParse({ ...hydrogen, symbol }).success,
        symbol,
      ).toBe(true);
    }
  });

  it("reads a vector typed with commas or spaces, preserving order", () => {
    const parsed = elementEditSchema.parse({
      ...hydrogen,
      shells: "2, 8, 18, 8, 1",
      ionizationEnergies: "418.8  3052  4420",
    });
    // Positional: the third ionization energy is the third one. Sorting or
    // de-duplicating would look tidier and be wrong.
    expect(parsed.shells).toEqual([2, 8, 18, 8, 1]);
    expect(parsed.ionizationEnergies).toEqual([418.8, 3052, 4420]);
  });

  it("rejects a vector containing something that is not a number", () => {
    expect(
      elementEditSchema.safeParse({ ...hydrogen, shells: "2, eight, 1" })
        .success,
    ).toBe(false);
  });
});

describe("implausibilities", () => {
  const parse = (overrides: Record<string, unknown> = {}): ElementEditInput =>
    elementEditSchema.parse({ ...hydrogen, ...overrides });

  it("accepts real data", () => {
    expect(implausibilities(parse())).toEqual([]);
  });

  it("catches values that are well-formed but impossible", () => {
    expect(implausibilities(parse({ atomicMass: "-1" }))).toContain(
      "Atomic mass must be above zero.",
    );
    expect(implausibilities(parse({ xpos: "19" })).length).toBeGreaterThan(0);
    expect(implausibilities(parse({ period: "0" })).length).toBeGreaterThan(0);
    expect(implausibilities(parse({ shells: "" }))).toContain(
      "An element has at least one electron shell.",
    );
    expect(
      implausibilities(parse({ shells: "2, 0, 1" })).length,
    ).toBeGreaterThan(0);
  });

  it("catches a boiling point below the melting point", () => {
    expect(implausibilities(parse({ melt: "100", boil: "50" }))).toContain(
      "The boiling point is below the melting point.",
    );
  });

  it("catches an ionization series that does not increase", () => {
    // Each successive electron is harder to remove, so a drop is a
    // transcription error rather than a discovery.
    const problems = implausibilities(
      parse({ ionizationEnergies: "1312, 900" }),
    );
    expect(problems.some((p) => p.includes("increase"))).toBe(true);
  });

  it("does not complain about an absent optional measurement", () => {
    expect(
      implausibilities(parse({ melt: "", boil: "", density: "" })),
    ).toEqual([]);
  });
});
