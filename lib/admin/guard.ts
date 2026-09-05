import "server-only";
import { notFound } from "next/navigation";

import {
  ForbiddenError,
  requirePermission,
  UnauthenticatedError,
  type PermissionContext,
} from "@/lib/authz";

/**
 * The permission check for an admin PAGE.
 *
 * `requirePermission` throws, and an uncaught throw in a page renders
 * `error.tsx` — with a 200 and a "something went wrong". That is the wrong
 * answer twice over: the status says the request succeeded, and the copy
 * suggests a bug rather than a boundary. It also differs from what the layout
 * does for the same condition, so `/admin` and `/admin/elements` would answer
 * an under-privileged visitor differently.
 *
 * Every admin page uses this instead. Anonymous visitors never reach it — the
 * layout has already redirected them to sign-in — so the only case left is
 * "signed in, not allowed", which is a 404: a 403 confirms the page exists.
 */
export async function requireAdminPermission(
  name: string,
): Promise<PermissionContext> {
  try {
    return await requirePermission(name);
  } catch (error) {
    if (
      error instanceof ForbiddenError ||
      error instanceof UnauthenticatedError
    ) {
      notFound();
    }
    throw error;
  }
}
