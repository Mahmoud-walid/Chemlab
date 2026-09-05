"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";

import { getDb } from "@/db/client";
import { elements } from "@/db/schema/content";
import { auditLog } from "@/db/schema/rbac";
import {
  elementEditSchema,
  implausibilities,
} from "@/lib/admin/element-schema";
import { requirePermission } from "@/lib/authz";
import { elementSlug } from "@/db/queries/elements";

export interface SaveResult {
  ok: boolean;
  /** Field-keyed messages, so the form can put each one where it belongs. */
  errors?: Record<string, string>;
  /** Problems that are not about one field — implausible combinations. */
  problems?: string[];
}

/**
 * Saves one element.
 *
 * `requirePermission` is the FIRST statement, before the input is even read:
 * an unauthorised caller should not get as far as having their payload
 * validated, and a check further down is a check someone will move.
 *
 * The atomic number comes from the route, not the form. It is the natural key,
 * and taking it from the payload would let a caller edit any element by
 * changing a hidden field — the same class of bug as trusting a `userId`.
 */
export async function updateElement(
  atomicNumber: number,
  formData: FormData,
): Promise<SaveResult> {
  const actor = await requirePermission("element:update");

  const parsed = elementEditSchema.safeParse({
    symbol: formData.get("symbol"),
    name: formData.get("name"),
    category: formData.get("category"),
    phase: formData.get("phase"),
    atomicMass: formData.get("atomicMass"),
    period: formData.get("period"),
    xpos: formData.get("xpos"),
    ypos: formData.get("ypos"),
    density: formData.get("density"),
    melt: formData.get("melt"),
    boil: formData.get("boil"),
    molarHeat: formData.get("molarHeat"),
    electronAffinity: formData.get("electronAffinity"),
    electronegativityPauling: formData.get("electronegativityPauling"),
    electronConfiguration: formData.get("electronConfiguration"),
    electronConfigurationSemantic: formData.get(
      "electronConfigurationSemantic",
    ),
    shells: formData.get("shells"),
    ionizationEnergies: formData.get("ionizationEnergies"),
    summary: formData.get("summary"),
    source: formData.get("source"),
    appearance: formData.get("appearance"),
    color: formData.get("color"),
    spectralImg: formData.get("spectralImg"),
    discoveredBy: formData.get("discoveredBy"),
    namedBy: formData.get("namedBy"),
  });

  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if (typeof field === "string" && !errors[field]) {
        errors[field] = issue.message;
      }
    }
    return { ok: false, errors };
  }

  const problems = implausibilities(parsed.data);
  if (problems.length > 0) return { ok: false, problems };

  const db = getDb();

  const [before] = await db
    .select()
    .from(elements)
    .where(eq(elements.number, atomicNumber))
    .limit(1);

  if (!before) {
    return { ok: false, problems: ["That element does not exist."] };
  }

  await db.transaction(async (tx) => {
    await tx
      .update(elements)
      .set(parsed.data)
      .where(eq(elements.number, atomicNumber));

    // In the same transaction as the change it describes: an edit with no
    // record, or a record with no edit, are both worse than neither.
    await tx.insert(auditLog).values({
      actorId: actor.userId,
      action: "element.update",
      targetType: "element",
      targetId: String(atomicNumber),
      before,
      after: { ...before, ...parsed.data },
    });
  });

  // The element pages are prerendered, so an edit that is not revalidated is
  // an edit nobody sees until the next deploy.
  revalidatePath("/admin/elements");
  revalidatePath(`/admin/elements/${atomicNumber}`);
  revalidatePath(`/chemical/${elementSlug(parsed.data.name)}`);
  revalidatePath(`/chemical/${elementSlug(before.name)}`);
  revalidatePath("/");

  return { ok: true };
}
