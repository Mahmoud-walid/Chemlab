import { getTranslations, setRequestLocale } from "next-intl/server";

import { listRoles } from "@/db/queries/admin/roles";
import { requireAdminPermission } from "@/lib/admin/guard";
import { hasPermission } from "@/lib/authz";
import { SUPER_ADMIN_ROLE_KEY } from "@/db/schema/rbac";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { Badge } from "@/components/ui/badge";
import { CreateRoleForm } from "./features/create-role-form";

export const dynamic = "force-dynamic";

/**
 * The roles, and what each one grants.
 *
 * The sidebar has linked here since the admin shell shipped and the route did
 * not exist, so the link 404'd — the same gap `/admin/users` had. Its own
 * `role:read` gate, as every admin page has: the layout gates the tree, but a
 * page that leans on its parent having checked is one refactor from being
 * unprotected.
 *
 * Rendered from the DATABASE, not from `db/seed/rbac.ts`. Authorization here is
 * data: a Super Admin can create a role at runtime, and a screen rendered from
 * the spec would not show it — which is the screen lying about who can do what.
 */
export default async function AdminRolesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);

  const actor = await requireAdminPermission("role:read");
  const canCreate = hasPermission(actor, "role:create");

  const roles = await listRoles();

  const t = await getTranslations("admin.roles");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      {roles.length === 0 ? (
        <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="p-3 text-start font-medium">
                  {t("columns.role")}
                </th>
                <th className="p-3 text-start font-medium">
                  {t("columns.permissions")}
                </th>
                <th className="p-3 text-start font-medium">
                  {t("columns.holders")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {roles.map((role) => (
                <tr key={role.id} className="hover:bg-muted/30">
                  <td className="p-3">
                    <Link
                      href={`/admin/roles/${role.id}`}
                      aria-label={t("view", { role: role.name })}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {role.name}
                    </Link>
                    {/* The key, not only the label: it is what the code matches
                        on and what a permission error will name. */}
                    <p className="font-mono text-xs text-muted-foreground">
                      {role.key}
                    </p>
                    <span className="mt-1 flex flex-wrap gap-1">
                      {role.isSystem && (
                        <Badge variant="secondary" className="text-[10px]">
                          {t("badges.system")}
                        </Badge>
                      )}
                      {role.isProtected && (
                        <Badge variant="secondary" className="text-[10px]">
                          {t("badges.protected")}
                        </Badge>
                      )}
                      {!role.isSystem && (
                        <Badge variant="outline" className="text-[10px]">
                          {t("badges.custom")}
                        </Badge>
                      )}
                    </span>
                  </td>
                  <td className="p-3 text-muted-foreground">
                    {/* Super Admin holds no grant rows, so a count would read
                        "0 grants" on the most powerful role in the system. */}
                    {role.key === SUPER_ADMIN_ROLE_KEY
                      ? t("grants.implicit")
                      : role.permissionNames.length === 0
                        ? t("noPermissions")
                        : t("permissionCount", {
                            count: role.permissionNames.length,
                          })}
                  </td>
                  <td className="p-3 text-muted-foreground tabular-nums">
                    {t("holderCount", { count: role.holderCount })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="space-y-2 rounded-lg border bg-secondary/40 p-4 text-sm">
        <p className="text-muted-foreground">{t("superAdminNote")}</p>
        <p className="text-muted-foreground">{t("seedNote")}</p>
        <p className="text-muted-foreground">{t("unheldNote")}</p>
      </div>

      {canCreate && (
        <CreateRoleForm
          labels={{
            heading: t("create.heading"),
            key: t("create.key"),
            keyHint: t("create.keyHint"),
            keyPlaceholder: t("create.keyPlaceholder"),
            name: t("create.name"),
            description: t("create.description"),
            submit: t("create.submit"),
            submitting: t("create.submitting"),
            failed: t("create.failed"),
          }}
        />
      )}
    </div>
  );
}
