"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";

import { getDb } from "@/db/client";
import { profiles, users } from "@/db/schema/auth";
import { profileSchema } from "@/lib/auth-schemas";
import { requireUser } from "@/lib/session";

export interface ProfileActionResult {
  ok: boolean;
  /** Field-keyed messages, so the form can put each one where it belongs. */
  errors?: Record<string, string>;
}

/**
 * Saves the signed-in user's profile.
 *
 * The acting user comes from the SESSION and nowhere else. This action takes no
 * user id, and adding one would be the bug: a client-supplied id turns "edit my
 * profile" into "edit anyone's profile" the moment someone changes a hidden
 * field.
 *
 * Validated with the same zod schema the form uses, because the form's
 * validation is a convenience for the person typing and proves nothing about
 * what arrived.
 */
export async function updateProfile(
  formData: FormData,
): Promise<ProfileActionResult> {
  const user = await requireUser();

  const parsed = profileSchema.safeParse({
    displayName: formData.get("displayName"),
    bio: formData.get("bio") ?? undefined,
    locale: formData.get("locale"),
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

  const db = getDb();
  await db.transaction(async (tx) => {
    await tx
      .update(profiles)
      .set({
        displayName: parsed.data.displayName,
        bio: parsed.data.bio || null,
        locale: parsed.data.locale,
      })
      .where(eq(profiles.userId, user.id));

    // The header reads `users.name` (it resolves the session in the browser),
    // so leaving this behind would show the old name everywhere except this
    // page. One transaction, so they cannot diverge.
    await tx
      .update(users)
      .set({ name: parsed.data.displayName })
      .where(eq(users.id, user.id));
  });

  revalidatePath("/profile");
  return { ok: true };
}
