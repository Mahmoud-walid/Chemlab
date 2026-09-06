/**
 * The permission vocabulary and the starting roles.
 *
 * Permissions are rows so the Super Admin can define them at runtime — but a
 * completely free-form string is a trap: a typo (`lesson:publsh`) creates a
 * permission that silently protects nothing, and looks exactly like one that
 * works. So the vocabulary is documented here and in `docs/PERMISSIONS.md`,
 * seeded on every deploy, and `requirePermission()` throws on a name that
 * matches no row rather than quietly denying.
 *
 * Pure data, no database import, so the seed and the tests can both read it.
 */

export const RESOURCES = [
  // Not a data resource: `admin:access` is the gate on the panel itself, and
  // holding it grants no data access on its own.
  "admin",
  "lesson",
  "element",
  "quiz",
  "exam",
  "comment",
  "page",
  "user",
  "role",
  "permission",
  "setting",
  "media",
  "notification",
  "audit",
  "activity",
  // Translating content is its own resource, not an action on `lesson` and
  // `quiz`. A translator works across every content type and must not thereby
  // gain the right to edit the English originals — which `lesson:update`
  // would give them.
  "translation",
] as const;

export const ACTIONS = [
  "read",
  "create",
  "update",
  "delete",
  "publish",
  "moderate",
  "assign",
  "impersonate",
  "export",
  "toggle",
  "bypass",
  "access",
  // `activity:read_pii`. The catalogue is `resource:action`, two parts, so
  // #19's `activity:read:pii` becomes an action of its own rather than a
  // third segment the whole model would have to grow to carry.
  "read_pii",
  // `setting:update_security`, by the same rule.
  "update_security",
  // `exam:void`. Striking out a sitting is not editing it: the row stays, the
  // reason is recorded, and the mark stops counting.
  "void",
  // `translation:write`. One grant rather than `create` plus `update`,
  // because starting a translation and finishing one are the same job — a
  // translator who could open a draft but not edit it back would be a
  // permission set nobody wants.
  "write",
  // `lesson:delete_hard`. The catalogue is `resource:action`, two parts, so
  // #64's `<resource>:delete:hard` becomes an action of its own — the same
  // rule that turned `activity:read:pii` into `activity:read_pii`.
  //
  // Deliberately NOT a narrower `delete`: soft delete keeps the row and can
  // be undone, and erasing one cannot. They are different decisions to trust
  // somebody with, which is exactly when a separate permission is right.
  "delete_hard",
  // `translation:review`. Checking a chemistry translation is a language
  // competence, not a publishing right, so it is separate from `write` and
  // from `lesson:publish`. A mistranslated definition is a factual error, and
  // the point of the separate grant is that somebody other than the author
  // signed it off.
  "review",
] as const;

export type Resource = (typeof RESOURCES)[number];
export type Action = (typeof ACTIONS)[number];

export interface PermissionSpec {
  resource: Resource;
  action: Action;
  description: string;
}

/** `resource:action`. The one place this string is built. */
export function permissionName(resource: string, action: string): string {
  return `${resource}:${action}`;
}

/**
 * Every permission that exists. Not every resource/action pairing is
 * meaningful, so this is an explicit list rather than a cross product — a
 * cross product would seed `audit:publish` and `element:moderate`, which
 * nothing will ever check.
 */
export const PERMISSIONS: PermissionSpec[] = [
  // The gate on /admin itself. Holding it grants no data access on its own.
  { resource: "admin", action: "access", description: "Open the admin panel" },

  {
    resource: "lesson",
    action: "read",
    description: "View unpublished lessons",
  },
  { resource: "lesson", action: "create", description: "Create lessons" },
  { resource: "lesson", action: "update", description: "Edit lessons" },
  { resource: "lesson", action: "delete", description: "Delete lessons" },
  {
    resource: "lesson",
    action: "delete_hard",
    description:
      "Erase a draft lesson that was never published and has no references",
  },
  {
    resource: "lesson",
    action: "publish",
    description: "Publish and unpublish lessons",
  },

  {
    resource: "element",
    action: "read",
    description: "View element records in the admin panel",
  },
  {
    resource: "element",
    action: "update",
    description: "Edit element records",
  },

  {
    resource: "quiz",
    action: "read",
    description: "View quizzes in the admin panel",
  },
  { resource: "quiz", action: "create", description: "Create quizzes" },
  { resource: "quiz", action: "update", description: "Edit quizzes" },
  { resource: "quiz", action: "delete", description: "Delete quizzes" },
  {
    resource: "quiz",
    action: "delete_hard",
    description:
      "Erase a draft quiz that was never published and has never been sat",
  },
  {
    resource: "quiz",
    action: "publish",
    description: "Publish and unpublish quizzes",
  },

  {
    resource: "exam",
    action: "read",
    description: "View exam attempts and scores",
  },
  { resource: "exam", action: "export", description: "Export exam results" },
  {
    resource: "exam",
    action: "void",
    // Separate from `exam:read` because voiding changes somebody's record.
    // Reading the scores and striking one out are different levels of trust,
    // and a void is visible to the candidate.
    description: "Strike out an exam attempt, with a reason",
  },

  {
    resource: "comment",
    action: "read",
    description: "View comments awaiting moderation",
  },
  {
    resource: "comment",
    action: "moderate",
    description: "Hide, restore and remove comments",
  },
  {
    resource: "comment",
    action: "delete",
    description: "Permanently delete comments",
  },

  {
    resource: "page",
    action: "read",
    description: "View page open/close state",
  },
  {
    resource: "page",
    action: "toggle",
    description: "Open and close pages to visitors",
  },
  {
    resource: "page",
    action: "bypass",
    // Separate from `toggle` on purpose: verifying a fix on a closed page and
    // deciding to close it are different acts, and the person checking is
    // often not the person who closed it. Without a bypass the only way to
    // confirm a repair is to reopen the page to everyone and hope.
    description: "See a closed page, with a banner, while visitors cannot",
  },

  { resource: "user", action: "read", description: "View user accounts" },
  { resource: "user", action: "update", description: "Edit user accounts" },
  { resource: "user", action: "delete", description: "Delete user accounts" },
  {
    resource: "user",
    action: "impersonate",
    description: "Sign in as another user",
  },

  { resource: "role", action: "read", description: "View roles" },
  { resource: "role", action: "create", description: "Create roles" },
  {
    resource: "role",
    action: "update",
    description: "Edit roles and their permissions",
  },
  { resource: "role", action: "delete", description: "Delete roles" },
  { resource: "role", action: "assign", description: "Grant and revoke roles" },

  { resource: "permission", action: "read", description: "View permissions" },
  {
    resource: "permission",
    action: "create",
    description: "Define new permissions",
  },
  {
    resource: "permission",
    action: "delete",
    description: "Remove permissions",
  },

  {
    resource: "setting",
    action: "read",
    description: "View platform settings",
  },
  {
    resource: "setting",
    action: "update",
    description: "Change platform settings",
  },
  {
    resource: "setting",
    action: "update_security",
    // Separate from `update` for the same reason `activity:read_pii` is
    // separate from `activity:read`. Session lifetime, the rate limits and the
    // OAuth provider list decide who gets in and how hard it is to try;
    // trusting somebody to rename the site is not the same decision.
    description:
      "Change security settings: sessions, rate limits and sign-in providers",
  },

  { resource: "media", action: "read", description: "Browse uploaded media" },
  { resource: "media", action: "create", description: "Upload media" },
  { resource: "media", action: "delete", description: "Delete media" },

  {
    resource: "notification",
    action: "read",
    description: "View sent notifications",
  },
  {
    resource: "notification",
    action: "create",
    description: "Send notifications",
  },

  { resource: "audit", action: "read", description: "Read the audit log" },

  {
    resource: "activity",
    action: "read",
    description: "Read the activity stream, with personal data withheld",
  },
  {
    resource: "activity",
    action: "read_pii",
    // Separate from `read` because IP address and user agent are personal
    // data. Someone reviewing what a feature is used for needs the stream;
    // they do not need to know where each person was sitting.
    description: "See IP addresses and user agents in the activity stream",
  },
  {
    resource: "activity",
    action: "export",
    description: "Export activity data",
  },

  {
    resource: "translation",
    action: "read",
    description: "See translation status, ownership and staleness",
  },
  {
    resource: "translation",
    action: "write",
    description: "Write and edit translations of content",
  },
  {
    resource: "translation",
    action: "review",
    description: "Approve a translation, or send it back to draft",
  },
];

export interface RoleSpec {
  key: string;
  name: string;
  description: string;
  isSystem: boolean;
  isProtected: boolean;
  /**
   * Names granted at seed time. `null` means "everything, implicitly" — the
   * Super Admin short-circuits in code and holds no role_permissions rows, so
   * that its power cannot be reduced by unlinking them.
   */
  permissions: string[] | null;
}

const p = permissionName;

export const ROLES: RoleSpec[] = [
  {
    key: "super_admin",
    name: "Super Admin",
    description:
      "Full control, including defining roles and permissions. Cannot be deleted, and at least one holder must always exist.",
    isSystem: true,
    isProtected: true,
    permissions: null,
  },
  {
    key: "admin",
    name: "Admin",
    description:
      "Runs the platform day to day, but cannot redefine authorization itself.",
    isSystem: true,
    isProtected: false,
    permissions: [
      p("admin", "access"),
      p("lesson", "read"),
      p("lesson", "create"),
      p("lesson", "update"),
      p("lesson", "delete"),
      p("lesson", "publish"),
      p("element", "read"),
      p("element", "update"),
      p("quiz", "read"),
      p("quiz", "create"),
      p("quiz", "update"),
      p("quiz", "delete"),
      p("quiz", "publish"),
      p("exam", "read"),
      p("exam", "export"),
      p("exam", "void"),
      p("comment", "read"),
      p("comment", "moderate"),
      p("comment", "delete"),
      p("page", "read"),
      p("page", "toggle"),
      p("page", "bypass"),
      p("user", "read"),
      p("user", "update"),
      p("role", "read"),
      p("role", "assign"),
      p("permission", "read"),
      p("setting", "read"),
      p("setting", "update"),
      p("setting", "update_security"),
      p("media", "read"),
      p("media", "create"),
      p("media", "delete"),
      p("notification", "read"),
      p("notification", "create"),
      p("audit", "read"),
      p("activity", "read"),
      p("activity", "read_pii"),
      p("activity", "export"),
      p("translation", "read"),
      p("translation", "write"),
      p("translation", "review"),
    ],
  },
  {
    key: "editor",
    name: "Editor",
    description:
      "Writes and publishes content. No access to users, roles or settings.",
    isSystem: true,
    isProtected: false,
    permissions: [
      p("admin", "access"),
      p("lesson", "read"),
      p("lesson", "create"),
      p("lesson", "update"),
      p("lesson", "publish"),
      p("element", "read"),
      p("element", "update"),
      p("quiz", "read"),
      p("quiz", "create"),
      p("quiz", "update"),
      p("quiz", "publish"),
      p("media", "read"),
      p("media", "create"),
      p("translation", "read"),
      // Write but not review: an editor can translate, and somebody else
      // signs it off. Self-approval is how an unchecked translation reaches
      // a reader looking exactly like a checked one.
      p("translation", "write"),
    ],
  },
  {
    key: "moderator",
    name: "Moderator",
    description:
      "Keeps discussion civil. Sees comments and the people who wrote them, nothing else.",
    isSystem: true,
    isProtected: false,
    permissions: [
      p("admin", "access"),
      p("comment", "read"),
      p("comment", "moderate"),
      p("user", "read"),
    ],
  },
  {
    key: "member",
    name: "Member",
    description:
      "Every signed-up visitor. Holds no admin permissions — the point is that authenticated-but-unprivileged is a real, inspectable state rather than an absence of rows.",
    isSystem: true,
    isProtected: false,
    permissions: [],
  },
];

/** Every permission name the vocabulary defines. */
export function allPermissionNames(): string[] {
  return PERMISSIONS.map((spec) => permissionName(spec.resource, spec.action));
}
