import "server-only";
import { eq } from "drizzle-orm";

import { getDb } from "@/db/client";
import { elements, lessons, quizzes } from "@/db/schema/content";
import { hasDatabase } from "@/db/queries/availability";

/**
 * The title of the record a dynamic admin segment names.
 *
 * Resolved in the LAYOUT rather than passed up from the page, because the
 * breadcrumb is rendered by the layout and a layout cannot receive data from
 * the page inside it. The alternatives were a client-side context the page
 * fills after hydration — which renders the id first and then swaps it, a
 * visible flicker on every navigation — or moving the breadcrumb into every
 * page, which is the same code four times.
 *
 * One query, only on a record route. The layout already makes a permission
 * query on every admin request; this adds one more on the editor screens only.
 *
 * A section not listed here simply keeps its raw segment, which is the current
 * behaviour and is correct for a slug. The case this exists for is
 * `/admin/elements/26`, where the segment is an atomic number and a breadcrumb
 * reading "26" tells the reader nothing.
 */

/** The path after `/admin`, with any locale prefix already stripped. */
function segmentsOf(pathname: string): string[] {
  return pathname
    .replace(/^\/(en|ar)(?=\/|$)/, "")
    .replace(/^\/admin/, "")
    .split("/")
    .filter(Boolean);
}

export async function crumbTitlesFor(
  pathname: string,
): Promise<Record<string, string>> {
  const [section, id] = segmentsOf(pathname);
  if (!section || !id || !hasDatabase()) return {};

  // `new` is the create screen, not a record. Looking it up would be a query
  // that can only ever miss.
  if (id === "new") return {};

  try {
    const db = getDb();

    if (section === "elements") {
      const atomicNumber = Number(id);
      if (!Number.isInteger(atomicNumber)) return {};
      const [row] = await db
        .select({ name: elements.name })
        .from(elements)
        .where(eq(elements.number, atomicNumber))
        .limit(1);
      return row ? { [id]: row.name } : {};
    }

    if (section === "lessons") {
      const [row] = await db
        .select({ title: lessons.title })
        .from(lessons)
        .where(eq(lessons.slug, id))
        .limit(1);
      return row ? { [id]: row.title } : {};
    }

    if (section === "quizzes") {
      const [row] = await db
        .select({ title: quizzes.title })
        .from(quizzes)
        .where(eq(quizzes.slug, id))
        .limit(1);
      return row ? { [id]: row.title } : {};
    }

    return {};
  } catch {
    // A breadcrumb is not worth failing a page over. Falling back to the raw
    // segment is exactly what happens when the record does not exist.
    return {};
  }
}
