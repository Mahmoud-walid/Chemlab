"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";

import { assignRole, revokeRole } from "../role-actions";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/ui/sonner";

export interface ManagedRole {
  id: string;
  key: string;
  name: string;
}

/**
 * The roles one account holds, and the controls to change them.
 *
 * The list of roles that can be GRANTED is computed on the server, by the same
 * pure rules the action re-checks — so a role this reader could not grant never
 * appears in the picker. That is convenience, not the gate: `role-actions.ts`
 * runs `refusalsForAssign` again on a freshly-read role, because the picker
 * could be minutes old and the role could have gained a permission since.
 *
 * Revoke is a button per role rather than a multi-select and a save: each
 * revocation is its own decision with its own refusals — the last Super Admin,
 * your own `role:assign` — and batching them would report one failure for
 * several intentions.
 */
export function RoleManager({
  userId,
  held,
  assignable,
  canAssign,
  labels,
}: {
  userId: string;
  held: ManagedRole[];
  /** Roles the reader may grant that this account does not already hold. */
  assignable: ManagedRole[];
  canAssign: boolean;
  labels: {
    heading: string;
    hint: string;
    add: string;
    addPlaceholder: string;
    adding: string;
    none: string;
    noneAssignable: string;
    readOnly: string;
    failed: string;
  };
}) {
  const t = useTranslations("admin.roles");
  const [pending, startTransition] = useTransition();
  const [choice, setChoice] = useState<string>("");

  function refuse(refusals: string[] | undefined) {
    toast.error({
      title: labels.failed,
      // Every reason at once.
      description: (refusals ?? ["gone"])
        .map((code) => t(`refusals.${code}` as never))
        .join(" "),
    });
  }

  function grant() {
    if (!choice) return;
    const role = assignable.find((candidate) => candidate.id === choice);
    startTransition(async () => {
      const result = await assignRole({ userId, roleId: choice });
      if (result.ok) {
        toast.success({
          title: t("assign.assigned", { role: role?.name ?? "" }),
          description: "",
        });
        setChoice("");
        return;
      }
      refuse(result.refusals);
    });
  }

  function revoke(role: ManagedRole) {
    startTransition(async () => {
      const result = await revokeRole({ userId, roleId: role.id });
      if (result.ok) {
        toast.success({
          title: t("assign.revoked", { role: role.name }),
          description: "",
        });
        return;
      }
      refuse(result.refusals);
    });
  }

  return (
    <section className="space-y-3">
      <div>
        <h2 className="font-semibold">{labels.heading}</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">{labels.hint}</p>
      </div>

      {held.length === 0 ? (
        <p className="text-sm text-muted-foreground">{labels.none}</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {held.map((role) => (
            <li key={role.id}>
              <span className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs">
                <span className="font-medium">{role.name}</span>
                <span className="font-mono text-muted-foreground">
                  {role.key}
                </span>
                {canAssign && (
                  <button
                    type="button"
                    onClick={() => revoke(role)}
                    disabled={pending}
                    aria-label={t("assign.revoke", { role: role.name })}
                    className="ms-0.5 rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                  >
                    <X aria-hidden className="size-3.5" />
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {!canAssign ? (
        <p className="text-xs text-muted-foreground">{labels.readOnly}</p>
      ) : assignable.length === 0 ? (
        /* Said, rather than shown as an empty picker. An empty dropdown reads
           as a page that failed to load its options. */
        <p className="text-xs text-muted-foreground">{labels.noneAssignable}</p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Select value={choice} onValueChange={setChoice} disabled={pending}>
            <SelectTrigger className="w-64" aria-label={labels.add}>
              <SelectValue placeholder={labels.addPlaceholder} />
            </SelectTrigger>
            <SelectContent>
              {assignable.map((role) => (
                <SelectItem key={role.id} value={role.id}>
                  {role.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" onClick={grant} disabled={pending || !choice}>
            {pending ? labels.adding : labels.add}
          </Button>
        </div>
      )}
    </section>
  );
}
