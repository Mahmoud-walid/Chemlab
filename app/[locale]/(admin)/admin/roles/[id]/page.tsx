import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { getRoleById, listPermissionGroups } from "@/db/queries/admin/roles";
import { requireAdminPermission } from "@/lib/admin/guard";
import { hasPermission } from "@/lib/authz";
import { refusalsForRoleDelete } from "@/lib/authz-roles";
import { SUPER_ADMIN_ROLE_KEY } from "@/db/schema/rbac";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { Badge } from "@/components/ui/badge";
import { DeleteRoleButton } from "../features/delete-role-button";
import { GrantsEditor } from "../features/grants-editor";
import { RenameRoleForm } from "../features/rename-role-form";

export const dynamic = "force-dynamic";

/**
 * One role: what it grants, and who holds it.
 *
 * Whether the grants are EDITABLE here is decided by three separate things, and
 * all three have to be true: the role is not a system role (the seed reconciles
 * those on every deploy, so an edit would silently revert), the reader holds
 * `role:update`, and the permission in question is one the reader holds
 * themselves. The third is the escalation rule — see `lib/authz-roles.ts`.
 */
export default async function AdminRoleDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale as Locale);

  const actor = await requireAdminPermission("role:read");

  const role = await getRoleById(id);
  if (!role) notFound();

  const groups = await listPermissionGroups();
  const t = await getTranslations("admin.roles");

  const isSuperAdmin = role.key === SUPER_ADMIN_ROLE_KEY;
  const canUpdate = hasPermission(actor, "role:update");
  const canSeeUsers = hasPermission(actor, "user:read");

  /**
   * The names this reader may switch on, and the ones they may not.
   *
   * A permission the role already grants but the reader does not hold is shown
   * as a fixed chip rather than an unchecked box or a disabled one: unchecked
   * would misreport what the role can do, and disabled invites a click that
   * cannot work. It is still submitted, because the editor sends the whole
   * intended set — dropping it would be a silent revocation.
   */
  const grantable = groups
    .flatMap((group) => group.permissions.map((permission) => permission.name))
    .filter((name) => hasPermission(actor, name));
  const grantableSet = new Set(grantable);
  const locked = role.permissionNames.filter((name) => !grantableSet.has(name));

  const deleteRefusals = refusalsForRoleDelete({
    role: {
      key: role.key,
      permissionNames: role.permissionNames,
      isSystem: role.isSystem,
      isProtected: role.isProtected,
    },
    holderCount: role.holderCount,
  });

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/roles"
          className="text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          {t("backToRoles")}
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">{role.name}</h1>
        <p className="font-mono text-sm text-muted-foreground">{role.key}</p>
        {role.description && (
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            {role.description}
          </p>
        )}
        <div className="mt-2 flex flex-wrap gap-1">
          {role.isSystem && (
            <Badge variant="secondary">{t("badges.system")}</Badge>
          )}
          {role.isProtected && (
            <Badge variant="secondary">{t("badges.protected")}</Badge>
          )}
          {!role.isSystem && (
            <Badge variant="outline">{t("badges.custom")}</Badge>
          )}
        </div>
      </div>

      {/* Absent on a system role: the seed rewrites `name` and `description`
          from the spec on every deploy, so the edit would hold until then and
          quietly revert. The header above already shows both. */}
      {canUpdate && !role.isSystem && (
        <RenameRoleForm
          roleId={role.id}
          roleKey={role.key}
          initialName={role.name}
          initialDescription={role.description ?? ""}
          labels={{
            heading: t("rename.heading"),
            name: t("rename.name"),
            description: t("rename.description"),
            save: t("rename.save"),
            saving: t("rename.saving"),
            saved: t("rename.saved"),
            failed: t("rename.failed"),
            keyFrozen: t("rename.keyFrozen"),
          }}
        />
      )}

      <section className="space-y-3">
        <h2 className="font-semibold">{t("grants.heading")}</h2>

        {isSuperAdmin ? (
          /* No checkbox list at all. Rendering 53 ticked boxes would suggest
             the power comes from those rows, and that unticking one would take
             it away — the exact misunderstanding the design prevents. */
          <div className="rounded-lg border bg-secondary/40 p-4 text-sm">
            <p className="font-medium">{t("grants.implicit")}</p>
            <p className="mt-1 text-muted-foreground">{t("superAdminNote")}</p>
          </div>
        ) : (
          <>
            {role.isSystem && (
              <p className="rounded-lg border bg-secondary/40 p-4 text-sm text-muted-foreground">
                {t("seedNote")}
              </p>
            )}
            <GrantsEditor
              roleId={role.id}
              groups={groups}
              granted={role.permissionNames}
              grantable={grantable}
              locked={locked}
              // Editable only when all three hold. The editor renders a
              // read-only list otherwise rather than a disabled form.
              editable={canUpdate && !role.isSystem}
              labels={{
                save: t("grants.save"),
                saving: t("grants.saving"),
                saved: t("grants.saved"),
                failed: t("grants.failed"),
                clearAll: t("grants.clearAll"),
                noPermissions: t("noPermissions"),
              }}
            />
          </>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">{t("holders.heading")}</h2>
        {role.holders.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("holders.none")}</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {role.holders.map((holder) => (
              <li key={holder.id} className="p-3 text-sm">
                {canSeeUsers ? (
                  <Link
                    href={`/admin/users/${holder.id}`}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {holder.name}
                  </Link>
                ) : (
                  /* Without `user:read` the name is as much as this page will
                     say — a link into a section they cannot open would 404. */
                  <span className="font-medium">{holder.name}</span>
                )}
                {canSeeUsers && (
                  <p className="text-xs text-muted-foreground">
                    {holder.email}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Absent, not disabled, when it cannot work — and absent for a reader
          without `role:delete` at all. The refusals are re-checked by the
          action; this only decides whether a control appears. */}
      {hasPermission(actor, "role:delete") && deleteRefusals.length === 0 && (
        <DeleteRoleButton
          roleId={role.id}
          labels={{
            action: t("remove.action"),
            confirmTitle: t("remove.confirmTitle", { role: role.name }),
            confirmBody: t("remove.confirmBody"),
            confirm: t("remove.confirm"),
            cancel: t("remove.cancel"),
            deleted: t("remove.deleted", { role: role.name }),
            failed: t("remove.failed"),
          }}
        />
      )}
    </div>
  );
}
