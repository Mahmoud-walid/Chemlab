import "server-only";
import { and, asc, eq, gt, or } from "drizzle-orm";

import { getDb } from "@/db/client";
import { sessions } from "@/db/schema/auth";
import { pages } from "@/db/schema/content";
import {
  permissions,
  rolePermissions,
  roles,
  userRoles,
} from "@/db/schema/rbac";
import { hasDatabase } from "./availability";
import { routeKeyFor, type ClosableRoute } from "@/lib/pages/routes";

/**
 * The open/closed map, read on every request that could be closed.
 *
 * Cached with a short TTL rather than queried per request. The proxy runs
 * ahead of every page, and a database round trip there is paid by every asset
 * miss and every prefetch — but the map is seven rows that change when an
 * operator clicks a switch, so a stale read for a few seconds is exactly the
 * trade a cache is for.
 *
 * The TTL is the ceiling on how long a closed page stays reachable. Writes call
 * `invalidatePageCache()`, so in one process the switch is immediate; the TTL
 * is what bounds it across several.
 *
 * Deliberately module-level rather than `unstable_cache`: the Next docs warn
 * that a proxy may be deployed separately from the app and should not rely on
 * shared caches, so this must degrade to "each instance keeps its own copy for
 * a few seconds" rather than depend on one being shared.
 */

export interface PageState {
  routeKey: string;
  isEnabled: boolean;
  showInNav: boolean;
  maintenanceMessage: Record<string, string> | null;
}

export const PAGE_CACHE_TTL_MS = 15_000;

let cached: { at: number; map: Map<string, PageState> } | null = null;

/** Drops the cached map. Called by every write, so a switch is felt at once. */
export function invalidatePageCache(): void {
  cached = null;
}

async function load(): Promise<Map<string, PageState>> {
  const rows = await getDb()
    .select({
      routeKey: pages.routeKey,
      isEnabled: pages.isEnabled,
      showInNav: pages.showInNav,
      maintenanceMessage: pages.maintenanceMessage,
    })
    .from(pages)
    .orderBy(asc(pages.routeKey));

  return new Map(rows.map((row) => [row.routeKey, row]));
}

/**
 * Every page's state, from cache when it is fresh.
 *
 * With no database configured this returns an empty map, which every caller
 * reads as "nothing is closed". `pnpm build` runs without one, and a build that
 * failed because the kill switch could not be consulted would be a switch that
 * takes the site down by existing.
 */
export async function getPageStates(): Promise<Map<string, PageState>> {
  if (!hasDatabase()) return new Map();

  const now = Date.now();
  if (cached && now - cached.at < PAGE_CACHE_TTL_MS) return cached.map;

  try {
    const map = await load();
    cached = { at: now, map };
    return map;
  } catch {
    // A database blip must not close the site. Serve the last known map if
    // there is one, and otherwise treat everything as open — the failure mode
    // of a kill switch should never be "kill everything".
    return cached?.map ?? new Map();
  }
}

/** The state governing a path, or null when no route key covers it. */
export async function pageStateFor(
  pathname: string,
): Promise<PageState | null> {
  const states = await getPageStates();
  if (states.size === 0) return null;

  const key = routeKeyFor(pathname, [...states.keys()]);
  return key ? (states.get(key) ?? null) : null;
}

/** The nav items still worth rendering: enabled, and flagged for the nav. */
export async function visibleNavRoutes(
  routes: readonly ClosableRoute[],
): Promise<Set<string>> {
  const states = await getPageStates();

  return new Set(
    routes
      .filter((route) => {
        const state = states.get(route.routeKey);
        // No row means no switch, which means open — the same default the
        // proxy uses, so the nav and the router never disagree.
        if (!state) return true;
        return state.isEnabled && state.showInNav;
      })
      .map((route) => route.routeKey),
  );
}

/**
 * Does the session behind this token hold `page:bypass`?
 *
 * Asked ONLY when a page is actually closed, which is why a query here is
 * affordable: the common path never reaches it. The alternative — a
 * "bypass" cookie set elsewhere — would be forgeable, and a kill switch that
 * anyone can walk past by setting a cookie is decoration.
 *
 * One query: session → roles → permissions, with the session's own expiry in
 * the WHERE clause so a stale cookie buys nothing. A Super Admin passes on
 * their role key alone, because their power is not modelled as
 * `role_permissions` rows and unlinking one must not defang them.
 */
export async function sessionHoldsBypass(
  cookieValue: string | undefined,
): Promise<boolean> {
  if (!cookieValue || !hasDatabase()) return false;

  // Better Auth signs the session cookie, so its value is `<token>.<signature>`
  // while `sessions.token` stores only the token. Matching the whole cookie
  // finds nothing — which fails closed, so the bug showed up as "the bypass
  // never works" rather than as a hole.
  //
  // The signature is not re-verified here. It guards against a tampered
  // cookie, but the token itself is the credential: anyone who knows a valid
  // one can already use it, and the expiry check below is what bounds that.
  const token = cookieValue.split(".")[0];
  if (!token) return false;

  try {
    const rows = await getDb()
      .select({ roleKey: roles.key, permission: permissions.name })
      .from(sessions)
      .innerJoin(userRoles, eq(userRoles.userId, sessions.userId))
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
      .leftJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .where(
        and(
          eq(sessions.token, token),
          gt(sessions.expiresAt, new Date()),
          or(
            eq(roles.key, SUPER_ADMIN_ROLE_KEY),
            eq(permissions.name, BYPASS_PERMISSION),
          ),
        ),
      )
      .limit(1);

    return rows.length > 0;
  } catch {
    // A database blip must not hand out a bypass.
    return false;
  }
}

const SUPER_ADMIN_ROLE_KEY = "super_admin";
const BYPASS_PERMISSION = "page:bypass";
