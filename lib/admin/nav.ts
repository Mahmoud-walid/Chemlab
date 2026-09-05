import {
  Atom,
  BarChart3,
  BookOpen,
  ClipboardList,
  FileText,
  MessageSquare,
  LayoutDashboard,
  ScrollText,
  Settings,
  ShieldCheck,
  Users,
  type LucideIcon,
} from "lucide-react";

/**
 * The admin navigation, as data.
 *
 * Declared here rather than as JSX so the server can filter it by the viewer's
 * permissions before it ever reaches the browser, and so the breadcrumb trail
 * and the command palette read from the same source as the sidebar — three
 * copies of "what is at /admin/lessons" is three chances to disagree.
 *
 * **Filtering is cosmetic.** Hiding a link an editor cannot use is courtesy,
 * not authorization: it stops nobody from typing the URL. Every admin page
 * calls `requirePermission()` itself, and so does every server action behind
 * it. If this file were the only thing standing between an editor and
 * `/admin/settings`, there would be no security here at all.
 */

/**
 * Message keys as literal unions, not `string`.
 *
 * next-intl types `t()` keys as a literal union, so typing these loosely would
 * force a cast at every call site — and a cast is exactly where a mistyped key
 * slips through. These match `messages/*.json` under the `admin` namespace, and
 * tests/lib/admin-nav.test.ts asserts every one resolves in both catalogues.
 */
export type AdminGroupKey =
  "groups.overview" | "groups.content" | "groups.people" | "groups.platform";

export type AdminItemKey =
  | "items.dashboard"
  | "items.elements"
  | "items.lessons"
  | "items.quizzes"
  | "items.exams"
  | "items.pages"
  | "items.comments"
  | "items.users"
  | "items.roles"
  | "items.activity"
  | "items.settings";

export interface AdminNavItem {
  /** Path under `/admin`, or "" for the dashboard itself. */
  segment: string;
  labelKey: AdminItemKey;
  icon: LucideIcon;
  /** The permission required to see AND to open it. */
  permission: string;
}

export interface AdminNavGroup {
  labelKey: AdminGroupKey;
  items: AdminNavItem[];
}

export const ADMIN_ROOT = "/admin";

export const ADMIN_NAV: AdminNavGroup[] = [
  {
    labelKey: "groups.overview",
    items: [
      {
        segment: "",
        labelKey: "items.dashboard",
        icon: LayoutDashboard,
        permission: "admin:access",
      },
    ],
  },
  {
    labelKey: "groups.content",
    items: [
      {
        segment: "elements",
        labelKey: "items.elements",
        icon: Atom,
        permission: "element:read",
      },
      {
        segment: "lessons",
        labelKey: "items.lessons",
        icon: BookOpen,
        permission: "lesson:read",
      },
      {
        // "quizzes", not "exams". #16 calls the section exams, but the table,
        // the public /quiz route and the `quiz:*` permissions all say quiz —
        // and `exam:read` in the permission catalogue means something else
        // entirely: viewing attempts and scores. Pointing this section at it
        // hid the whole section from an Editor holding every quiz permission.
        segment: "quizzes",
        labelKey: "items.quizzes",
        icon: ClipboardList,
        permission: "quiz:read",
      },
      {
        // Guarded by `exam:read`, which in this vocabulary means exactly
        // this: view attempts and scores. Deliberately not `quiz:read` — an
        // Editor who writes the questions has no reason to see who scored
        // what, and the two are different grants for that reason.
        segment: "exams",
        labelKey: "items.exams",
        icon: BarChart3,
        permission: "exam:read",
      },
      {
        segment: "pages",
        labelKey: "items.pages",
        icon: FileText,
        permission: "page:read",
      },
      {
        // The report queue. Guarded by `comment:read`, which in this
        // vocabulary means exactly "see comments awaiting moderation" — a
        // moderator needs it and an Editor who writes lessons does not.
        segment: "comments",
        labelKey: "items.comments",
        icon: MessageSquare,
        permission: "comment:read",
      },
    ],
  },
  {
    labelKey: "groups.people",
    items: [
      {
        segment: "users",
        labelKey: "items.users",
        icon: Users,
        permission: "user:read",
      },
      {
        segment: "roles",
        labelKey: "items.roles",
        icon: ShieldCheck,
        permission: "role:read",
      },
    ],
  },
  {
    labelKey: "groups.platform",
    items: [
      {
        segment: "activity",
        labelKey: "items.activity",
        icon: ScrollText,
        // The activity stream, not the audit log. `audit:read` still exists
        // and still guards the audit log, which is a different table for a
        // different purpose — see db/schema/activity.ts.
        permission: "activity:read",
      },
      {
        segment: "settings",
        labelKey: "items.settings",
        icon: Settings,
        permission: "setting:read",
      },
    ],
  },
];

/** The href for a nav item. One place, so the sidebar and breadcrumbs agree. */
export function hrefFor(segment: string): string {
  return segment ? `${ADMIN_ROOT}/${segment}` : ADMIN_ROOT;
}

/**
 * The groups a viewer may see, with the items they may not removed.
 *
 * A group whose every item is filtered away renders nothing at all — an empty
 * heading is worse than an absent one, because it advertises a section the
 * viewer cannot reach and looks like a bug.
 */
export function visibleNav(
  permissions: ReadonlySet<string>,
  isSuperAdmin: boolean,
): AdminNavGroup[] {
  return ADMIN_NAV.map((group) => ({
    ...group,
    items: group.items.filter(
      (item) => isSuperAdmin || permissions.has(item.permission),
    ),
  })).filter((group) => group.items.length > 0);
}

/** Every item, flattened — for breadcrumbs and the command palette. */
export function flattenNav(groups: AdminNavGroup[]): AdminNavItem[] {
  return groups.flatMap((group) => group.items);
}

/**
 * The permission a path under `/admin` requires, or null when the nav does not
 * claim it.
 *
 * The nav declaration already records what each section needs, so enforcement
 * reads the same line the filtering does — one place to change, and no way for
 * a link to be shown that the guard would then refuse.
 *
 * Matched on the first segment: `/admin/lessons/abc` needs what `/admin/lessons`
 * needs. A deeper route wanting something stricter says so in its own page.
 */
export function permissionForPath(pathname: string): string | null {
  const path = pathname
    .replace(/^\/(en|ar)(?=\/|$)/, "")
    .replace(/^\/admin\/?/, "");
  const segment = path.split("/").filter(Boolean)[0] ?? "";

  const item = flattenNav(ADMIN_NAV).find(
    (candidate) => candidate.segment === segment,
  );
  return item?.permission ?? null;
}

export interface Crumb {
  href: string;
  /** A message key, when the segment is a known nav item. */
  labelKey?: AdminItemKey;
  /** A literal label, when it is not — a record title, say. */
  label?: string;
  /** The last crumb is the current page and is not a link. */
  isCurrent: boolean;
}

/**
 * Builds the breadcrumb trail for an admin path.
 *
 * Derived from the nav declaration, not from raw URL segments: "roles" should
 * read as "Roles and permissions", and a dynamic segment is an id nobody wants
 * to see. `titles` lets the page supply the record's real title for those —
 * without it, `/admin/lessons/01a06e…` would render a UUID as a breadcrumb.
 */
export function breadcrumbsFor(
  pathname: string,
  titles: Record<string, string> = {},
): Crumb[] {
  // Everything after `/admin`, with any locale prefix already stripped.
  const withoutRoot = pathname
    .replace(/^\/(en|ar)(?=\/|$)/, "")
    .replace(/^\/admin/, "")
    .split("/")
    .filter(Boolean);

  const crumbs: Crumb[] = [
    {
      href: ADMIN_ROOT,
      labelKey: "items.dashboard",
      isCurrent: withoutRoot.length === 0,
    },
  ];

  const known = new Map(
    flattenNav(ADMIN_NAV).map((item) => [item.segment, item.labelKey]),
  );

  let href = ADMIN_ROOT;
  withoutRoot.forEach((segment, index) => {
    href = `${href}/${segment}`;
    const isCurrent = index === withoutRoot.length - 1;
    const labelKey = known.get(segment);

    crumbs.push(
      labelKey
        ? { href, labelKey, isCurrent }
        : { href, label: titles[segment] ?? segment, isCurrent },
    );
  });

  return crumbs;
}
