"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";

import { saveSettings, type SettingSubmission } from "../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/sonner";

export type SettingKind = "text" | "longText" | "boolean" | "select";

export interface SettingField {
  key: string;
  kind: SettingKind;
  value: unknown;
  seenAt: string | null;
  label: string;
  help?: string;
  options?: { value: string; label: string }[];
}

/**
 * One section's form.
 *
 * Deliberately NOT optimistic. These are platform-wide switches: a silently
 * reverted "registration is closed" is a claim about the site that turns out
 * to be false, and the operator would have no way to tell. Row toggles
 * elsewhere can afford optimism; configuration cannot.
 *
 * Read-only mode renders the same inputs disabled rather than hiding them, so
 * the platform's configuration stays legible to anyone who can see the page.
 * A section that vanished would read as "this does not exist".
 */
export function SettingsForm({
  section,
  fields,
  canEdit,
  labels,
}: {
  section: string;
  fields: SettingField[];
  canEdit: boolean;
  labels: { save: string; saving: string; saved: string; readOnly: string };
}) {
  const t = useTranslations("admin.settings");
  const [pending, startTransition] = useTransition();
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    Object.fromEntries(fields.map((field) => [field.key, field.value])),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);

  const set = (key: string, value: unknown) =>
    setValues((current) => ({ ...current, [key]: value }));

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setErrors({});
    setProblem(null);

    const submissions: SettingSubmission[] = fields.map((field) => ({
      key: field.key,
      value: values[field.key],
      // Sent back exactly as rendered, so the server can tell whether anybody
      // changed this key since the form was drawn.
      seenAt: field.seenAt,
    }));

    startTransition(async () => {
      const result = await saveSettings(submissions);
      if (result.ok) {
        toast.success({ title: labels.saved, description: "" });
        return;
      }
      if (result.conflict) {
        setProblem(t("conflict", { key: result.conflict.key }));
      } else {
        setProblem(result.problem ?? null);
      }
      setErrors(result.errors ?? {});
      toast.error({ title: t("saveFailed"), description: "" });
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      {!canEdit && (
        <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
          {labels.readOnly}
        </p>
      )}

      {problem && (
        <p
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm"
        >
          {problem}
        </p>
      )}

      <div className="space-y-5">
        {fields.map((field) => {
          const error = errors[field.key];
          const describedBy = error
            ? `${field.key}-error`
            : field.help
              ? `${field.key}-help`
              : undefined;

          return (
            <div key={field.key} className="space-y-1.5">
              {field.kind === "boolean" ? (
                <label className="flex items-center gap-3">
                  <Switch
                    checked={Boolean(values[field.key])}
                    disabled={!canEdit || pending}
                    aria-label={field.label}
                    onCheckedChange={(next) => set(field.key, next)}
                  />
                  <span className="text-sm font-medium">{field.label}</span>
                </label>
              ) : (
                <>
                  <Label htmlFor={field.key}>{field.label}</Label>
                  {field.kind === "longText" ? (
                    <Textarea
                      id={field.key}
                      rows={3}
                      disabled={!canEdit || pending}
                      value={String(values[field.key] ?? "")}
                      aria-invalid={Boolean(error)}
                      aria-describedby={describedBy}
                      onChange={(event) => set(field.key, event.target.value)}
                    />
                  ) : field.kind === "select" ? (
                    <select
                      id={field.key}
                      disabled={!canEdit || pending}
                      value={String(values[field.key] ?? "")}
                      aria-invalid={Boolean(error)}
                      aria-describedby={describedBy}
                      onChange={(event) => set(field.key, event.target.value)}
                      className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
                    >
                      {field.options?.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <Input
                      id={field.key}
                      disabled={!canEdit || pending}
                      value={String(values[field.key] ?? "")}
                      aria-invalid={Boolean(error)}
                      aria-describedby={describedBy}
                      onChange={(event) => set(field.key, event.target.value)}
                    />
                  )}
                </>
              )}

              {field.help && !error && (
                <p
                  id={`${field.key}-help`}
                  className="text-xs text-muted-foreground"
                >
                  {field.help}
                </p>
              )}
              {error && (
                <p
                  id={`${field.key}-error`}
                  role="alert"
                  className="text-sm text-destructive"
                >
                  {error}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {canEdit && (
        <Button type="submit" disabled={pending} name={`save-${section}`}>
          {pending ? labels.saving : labels.save}
        </Button>
      )}
    </form>
  );
}
