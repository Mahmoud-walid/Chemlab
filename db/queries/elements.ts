import "server-only";
import { asc, desc, eq, gt, lt, sql } from "drizzle-orm";

import { getDb } from "@/db/client";
import { elements } from "@/db/schema/content";
import type { Element } from "@/types/element";

/**
 * The URL segment for an element page. Elements have no slug column — the name
 * is already unique — so the mapping is defined once here rather than being
 * re-derived at four call sites.
 */
export function elementSlug(name: string): string {
  return name.toLowerCase();
}

/**
 * Database row -> the snake_case shape the UI has always used.
 *
 * Kept as an explicit mapper rather than renaming the columns or the interface:
 * the JSON field names are the ones the periodic-table components, the tests
 * and `types/element.ts` all speak, and the schema follows the repo's
 * camelCase convention. One translation layer beats a rename touching both.
 */
function toElement(row: typeof elements.$inferSelect): Element {
  return {
    name: row.name,
    appearance: row.appearance,
    atomic_mass: row.atomicMass,
    boil: row.boil,
    category: row.category,
    color: row.color,
    density: row.density,
    discovered_by: row.discoveredBy,
    melt: row.melt,
    molar_heat: row.molarHeat,
    named_by: row.namedBy,
    number: row.number,
    period: row.period,
    phase: row.phase,
    source: row.source,
    spectral_img: row.spectralImg,
    summary: row.summary,
    symbol: row.symbol,
    xpos: row.xpos,
    ypos: row.ypos,
    shells: row.shells,
    electron_configuration: row.electronConfiguration,
    electron_configuration_semantic: row.electronConfigurationSemantic,
    electron_affinity: row.electronAffinity,
    electronegativity_pauling: row.electronegativityPauling,
    ionization_energies: row.ionizationEnergies,
  };
}

/** Every element, in atomic-number order — what the periodic table renders. */
export async function listElements(): Promise<Element[]> {
  const rows = await getDb()
    .select()
    .from(elements)
    .orderBy(asc(elements.number));
  return rows.map(toElement);
}

/** One element by its URL slug, or null when the slug matches nothing. */
export async function getElementBySlug(slug: string): Promise<Element | null> {
  const rows = await getDb()
    .select()
    .from(elements)
    // Compare lowercased in SQL so the index-free lookup still matches a slug
    // like "iron" against the stored "Iron", without pulling 119 rows to find
    // one.
    .where(eq(sql`lower(${elements.name})`, slug.toLowerCase()))
    .limit(1);
  return rows[0] ? toElement(rows[0]) : null;
}

/** Slugs only — for `generateStaticParams` and the sitemap. */
export async function listElementSlugs(): Promise<string[]> {
  const rows = await getDb()
    .select({ name: elements.name })
    .from(elements)
    .orderBy(asc(elements.number));
  return rows.map((row) => elementSlug(row.name));
}

export interface ElementNeighbours {
  previous: Element | null;
  next: Element | null;
}

/**
 * The elements either side of one atomic number, for the prev/next links.
 *
 * One query rather than two, and it does not assume the numbers are
 * contiguous: `1..119` has no gaps today, but ordering by distance means a
 * retracted element would shift the links rather than break them.
 */
export async function getElementNeighbours(
  number: number,
): Promise<ElementNeighbours> {
  const db = getDb();
  const [previous, next] = await Promise.all([
    db
      .select()
      .from(elements)
      .where(lt(elements.number, number))
      .orderBy(desc(elements.number))
      .limit(1),
    db
      .select()
      .from(elements)
      .where(gt(elements.number, number))
      .orderBy(asc(elements.number))
      .limit(1),
  ]);
  return {
    previous: previous[0] ? toElement(previous[0]) : null,
    next: next[0] ? toElement(next[0]) : null,
  };
}
