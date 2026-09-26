"use client";

import { useState, useTransition } from "react";
import { useRouter } from "@/i18n/navigation";
import { useTranslations } from "next-intl";

import { createRole } from "../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/ui/sonner";

/** A role this reader may copy the grants of. */
export interface CloneSource {
  id: string;
  name: string;
  grantCount: number;
}

/** The sentinel for "no source". An empty string cannot be a Select value. */
const NO_SOURCE = "none";

/**
 * Creating a role.
 *
 * Submitted, not typed-through, and with no optimistic layer: the key cannot be
 * changed afterwards on a system role and is what code matches on, so this is
 * the opposite of the page switches — a deliberate act with a permanent part to
 * it, which deserves a button and a round trip.
 *
 * Either empty, or cloned. Cloning is what makes a SYSTEM role's power
 * customisable: its own grants cannot be edited, because the seed reconciles
 * them on every deploy — so "Editor, plus hard delete" is otherwise sixteen
 * boxes ticked by hand with one of them silently forgotten.
 *
 * The picker offers only sources this reader could grant in full. A source
 * holding more than they do is absent rather than listed-and-refused, and the
 * action re-checks against a freshly-read role anyway.
 */
export function CreateRoleForm({
  labels,
  sources,
}: {
  /** Roles whose grants this reader may copy. Empty hides the picker. */
  sources: CloneSource[];
  labels: {
    heading: string;
    key: string;
    keyHint: string;
    keyPlaceholder: string;
    name: string;
    description: string;
    submit: string;
    submitting: string;
    failed: string;
    cloneLabel: string;
    cloneNone: string;
    cloneHint: string;
  };
}) {
  const t = useTranslations("admin.roles");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [source, setSource] = useState<string>(NO_SOURCE);

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      const result = await createRole({
        key,
        name,
        description,
        copyFromRoleId: source === NO_SOURCE ? undefined : source,
      });

      if (result.ok && result.roleId) {
        toast.success({
          title: t("create.created", { name }),
          description: "",
        });
        setKey("");
        setName("");
        setDescription("");
        setSource(NO_SOURCE);
        // Straight to the new role, because the next thing anybody wants is to
        // decide what it grants — and that lives on its own page.
        router.push(`/admin/roles/${result.roleId}`);
        return;
      }

      toast.error({
        title: labels.failed,
        // Every reason at once. An operator who fixes the key and is then told
        // the name is blank has been made to discover the rules one round trip
        // at a time.
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
          <Label htmlFor="role-key">{labels.key}</Label>
          <Input
            id="role-key"
            value={key}
            onChange={(event) => setKey(event.target.value)}
            // Lower-cased as it is typed rather than silently on the server, so
            // what the operator reads back is what will be stored.
            onBlur={() => setKey(key.trim().toLowerCase())}
            placeholder={labels.keyPlaceholder}
            className="font-mono"
            required
            aria-describedby="role-key-hint"
          />
          <p id="role-key-hint" className="text-xs text-muted-foreground">
            {labels.keyHint}
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="role-name">{labels.name}</Label>
          <Input
            id="role-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="role-description">{labels.description}</Label>
        <Input
          id="role-description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </div>

      {sources.length > 0 && (
        <div className="space-y-1.5">
          <Label htmlFor="role-clone">{labels.cloneLabel}</Label>
          <Select value={source} onValueChange={setSource} disabled={pending}>
            <SelectTrigger id="role-clone" className="w-full sm:w-80">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_SOURCE}>{labels.cloneNone}</SelectItem>
              {sources.map((candidate) => (
                <SelectItem key={candidate.id} value={candidate.id}>
                  {candidate.name}
                  {candidate.grantCount > 0 && (
                    <span className="ms-2 text-xs text-muted-foreground tabular-nums">
                      {candidate.grantCount}
                    </span>
                  )}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">{labels.cloneHint}</p>
        </div>
      )}

      <Button type="submit" disabled={pending}>
        {pending ? labels.submitting : labels.submit}
      </Button>
    </form>
  );
}
