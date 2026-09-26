"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";

import { renameRole } from "../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/sonner";

/**
 * A role's display name and description.
 *
 * Rendered only for a role whose name can actually change — a custom one. On a
 * system role the database would ACCEPT this edit (`roles_protect_system`
 * freezes the key alone), and `db/seed/authorization.ts` would put the spec's
 * name back on the next deploy with nothing reporting it. That is the same trap
 * as its grants, and the same answer: absent, with the reason said once.
 *
 * The key is not a field here at all, on any role. It is what code matches on
 * and what a permission error names, so it is shown as text with the reason
 * beside it rather than as an input that refuses.
 */
export function RenameRoleForm({
  roleId,
  roleKey,
  initialName,
  initialDescription,
  labels,
}: {
  roleId: string;
  roleKey: string;
  initialName: string;
  initialDescription: string;
  labels: {
    heading: string;
    name: string;
    description: string;
    save: string;
    saving: string;
    saved: string;
    failed: string;
    keyFrozen: string;
  };
}) {
  const t = useTranslations("admin.roles");
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);

  const unchanged =
    name.trim() === initialName.trim() &&
    description.trim() === initialDescription.trim();

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      const result = await renameRole({ roleId, name, description });

      if (result.ok) {
        toast.success({ title: labels.saved, description: "" });
        return;
      }
      toast.error({
        title: labels.failed,
        // Every reason at once.
        description: (result.refusals ?? ["gone"])
          .map((code) => t(`refusals.${code}` as never))
          .join(" "),
      });
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-lg border p-4">
      <h2 className="font-semibold">{labels.heading}</h2>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="role-rename">{labels.name}</Label>
          <Input
            id="role-rename"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="role-redescribe">{labels.description}</Label>
          <Input
            id="role-redescribe"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </div>
      </div>

      <p className="font-mono text-xs text-muted-foreground">
        {roleKey}
        <span className="ms-2 font-sans">{labels.keyFrozen}</span>
      </p>

      {/* Disabled while nothing has changed, not absent: the button is the
          affordance that tells the reader this form saves at all. */}
      <Button type="submit" size="sm" disabled={pending || unchanged}>
        {pending ? labels.saving : labels.save}
      </Button>
    </form>
  );
}
