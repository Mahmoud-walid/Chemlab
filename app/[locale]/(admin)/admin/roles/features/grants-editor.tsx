"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";

import { setRolePermissions } from "../actions";
import type { PermissionGroup } from "@/db/queries/admin/roles";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/sonner";

/**
 * Which permissions a role grants.
 *
 * Grouped by resource because `permissions.resource` and `.action` are separate
 * columns for exactly this — the schema says so — and 53 flat checkboxes is a
 * list nobody reads.
 *
 * No optimistic layer, unlike the page switches: this is a set of changes saved
 * together, so an optimistic tick would have to be rolled back field by field
 * on failure, and a half-rolled-back permission form is worse than a slow one.
 * The button is the commit.
 */
export function GrantsEditor({
  roleId,
  groups,
  granted,
  grantable,
  locked,
  editable,
  labels,
}: {
  roleId: string;
  groups: PermissionGroup[];
  /** What the role grants now. */
  granted: string[];
  /** The names this reader may switch on or off. */
  grantable: string[];
  /**
   * Granted, but beyond this reader's own permissions.
   *
   * Rendered as fixed chips and submitted unchanged. Leaving them out of the
   * payload would be a silent revocation of exactly the permissions the reader
   * is not trusted to touch.
   */
  locked: string[];
  editable: boolean;
  labels: {
    save: string;
    saving: string;
    saved: string;
    failed: string;
    clearAll: string;
    noPermissions: string;
  };
}) {
  const t = useTranslations("admin.roles");
  const [pending, startTransition] = useTransition();
  const grantableSet = new Set(grantable);

  /**
   * Only the grantable names, and that matters.
   *
   * Seeding this from `granted` wholesale put every LOCKED permission into the
   * checkbox list as well — ticked, and apparently toggleable. Unticking one did
   * nothing at all, because `save` re-adds `locked` to the payload
   * unconditionally. A control that moves and changes nothing is worse than an
   * absent one: the operator believes the grant was removed.
   */
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(granted.filter((name) => grantableSet.has(name))),
  );

  const visibleGroups = groups
    .map((group) => ({
      resource: group.resource,
      // A permission the reader does not hold is absent rather than disabled:
      // there is no state of this form in which they could set it, and the ones
      // the role already has are shown as fixed chips above instead.
      permissions: group.permissions.filter((permission) =>
        grantableSet.has(permission.name),
      ),
    }))
    .filter((group) => group.permissions.length > 0);

  function toggle(name: string, on: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(name);
      else next.delete(name);
      return next;
    });
  }

  function save() {
    startTransition(async () => {
      const result = await setRolePermissions({
        roleId,
        // The whole intended set, locked names included — see `locked` above.
        permissionNames: [...new Set([...selected, ...locked])],
      });

      if (result.ok) {
        toast.success({ title: labels.saved, description: "" });
        return;
      }
      toast.error({
        title: labels.failed,
        description: (result.refusals ?? ["gone"])
          .map((code) => t(`refusals.${code}` as never))
          .join(" "),
      });
    });
  }

  if (!editable) {
    return granted.length === 0 ? (
      <p className="text-sm text-muted-foreground">{labels.noPermissions}</p>
    ) : (
      <div className="flex flex-wrap gap-1.5">
        {[...granted].sort().map((name) => (
          <Badge key={name} variant="outline" className="font-mono text-[11px]">
            {name}
          </Badge>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {locked.length > 0 && (
        <div className="rounded-lg border bg-secondary/40 p-3">
          <p className="mb-1.5 text-xs text-muted-foreground">
            {t("refusals.would-escalate")}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {locked.map((name) => (
              <Badge
                key={name}
                variant="secondary"
                className="font-mono text-[11px]"
              >
                {name}
              </Badge>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-4">
        {visibleGroups.map((group) => (
          <fieldset key={group.resource} className="rounded-lg border p-3">
            <legend className="px-1 font-mono text-xs font-bold uppercase tracking-widest text-primary-text">
              {group.resource}
            </legend>
            <div className="mt-1 grid gap-2 sm:grid-cols-2">
              {group.permissions.map((permission) => (
                <div
                  key={permission.name}
                  className="flex items-start gap-2.5 text-sm"
                >
                  <Checkbox
                    id={`perm-${permission.name}`}
                    checked={selected.has(permission.name)}
                    onCheckedChange={(state) =>
                      toggle(permission.name, state === true)
                    }
                    disabled={pending}
                  />
                  <Label
                    htmlFor={`perm-${permission.name}`}
                    className="cursor-pointer font-normal leading-snug"
                  >
                    <span className="font-mono text-xs">
                      {permission.action}
                    </span>
                    {permission.description && (
                      <span className="block text-xs text-muted-foreground">
                        {permission.description}
                      </span>
                    )}
                  </Label>
                </div>
              ))}
            </div>
          </fieldset>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={pending} size="sm">
          {pending ? labels.saving : labels.save}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={pending || selected.size === 0}
          onClick={() => setSelected(new Set())}
        >
          {labels.clearAll}
        </Button>
        <span className="text-xs text-muted-foreground tabular-nums">
          {t("grants.selected", { count: selected.size + locked.length })}
        </span>
      </div>
    </div>
  );
}
