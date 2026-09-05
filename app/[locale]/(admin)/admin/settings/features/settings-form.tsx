"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";

import { saveSettings, type SettingSubmission } from "../actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/sonner";

import type { SettingKind } from "@/lib/settings/registry";

export type { SettingKind };

export interface SettingField {
  key: string;
  kind: SettingKind;
  value: unknown;
  seenAt: string | null;
  label: string;
  help?: string;
  options?: SettingOption[];
}

/**
 * A read-only row: something configured in the environment, reported as a
 * boolean and nothing else. Never the value, never a prefix, never a length.
 */
export interface SettingStatusRow {
  id: string;
  label: string;
  configured: boolean;
  help?: string;
}

export interface SettingOption {
  value: string;
  label: string;
  /**
   * Why this option cannot be picked — an OAuth provider with no credentials
   * in the environment, for instance. Rendered next to the option rather than
   * hiding it: a provider that simply vanished reads as "not supported", and
   * the operator never learns that one environment variable is all it needs.
   */
  disabledReason?: string;
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
  status = [],
  labels,
}: {
  section: string;
  fields: SettingField[];
  canEdit: boolean;
  /** Environment-backed rows, shown above the editable ones. */
  status?: SettingStatusRow[];
  labels: {
    save: string;
    saving: string;
    saved: string;
    readOnly: string;
    configured: string;
    notConfigured: string;
  };
}) {
  const t = useTranslations("admin.settings");
  const [pending, startTransition] = useTransition();
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    Object.fromEntries(fields.map((field) => [field.key, field.value])),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);

  const asList = (value: unknown): string[] =>
    Array.isArray(value) ? (value as string[]) : [];

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

      {status.length > 0 && (
        <dl className="divide-y rounded-lg border">
          {status.map((row) => (
            <div
              key={row.id}
              className="flex items-start justify-between gap-4 p-3"
            >
              <div>
                <dt className="text-sm font-medium">{row.label}</dt>
                {row.help && (
                  <dd className="text-xs text-muted-foreground">{row.help}</dd>
                )}
              </div>
              <dd>
                <ConfigStatus configured={row.configured} labels={labels} />
              </dd>
            </div>
          ))}
        </dl>
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
                  ) : field.kind === "multiSelect" ? (
                    <fieldset
                      id={field.key}
                      aria-describedby={describedBy}
                      className="flex flex-wrap gap-4 rounded-md border p-3"
                    >
                      <legend className="sr-only">{field.label}</legend>
                      {field.options?.map((option) => {
                        const selected = asList(values[field.key]);
                        return (
                          <label
                            key={option.value}
                            className="flex items-center gap-2 text-sm"
                            title={option.disabledReason}
                          >
                            <Checkbox
                              checked={selected.includes(option.value)}
                              disabled={
                                !canEdit ||
                                pending ||
                                Boolean(option.disabledReason)
                              }
                              onCheckedChange={(next) =>
                                set(
                                  field.key,
                                  next === true
                                    ? [...selected, option.value]
                                    : selected.filter(
                                        (value) => value !== option.value,
                                      ),
                                )
                              }
                            />
                            <span>{option.label}</span>
                            {option.disabledReason && (
                              <span className="text-xs text-muted-foreground">
                                {option.disabledReason}
                              </span>
                            )}
                          </label>
                        );
                      })}
                    </fieldset>
                  ) : (
                    <Input
                      id={field.key}
                      type={field.kind === "number" ? "number" : "text"}
                      inputMode={
                        field.kind === "number" ? "numeric" : undefined
                      }
                      disabled={!canEdit || pending}
                      value={String(values[field.key] ?? "")}
                      aria-invalid={Boolean(error)}
                      aria-describedby={describedBy}
                      // A number field's value is kept as the STRING the input
                      // holds. Coercing on every keystroke turns a cleared
                      // field into 0 and a half-typed "-" into NaN; the
                      // schema converts it once, on the server.
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

/**
 * Configured or not. That is the entire vocabulary.
 *
 * There is deliberately no "partially configured", no masked prefix and no
 * character count: each of those is a disclosure of a secret, and a length
 * alone can distinguish two candidate keys. The boolean is computed on the
 * server from environment presence and arrives here already reduced.
 */
export function ConfigStatus({
  configured,
  labels,
}: {
  configured: boolean;
  labels: { configured: string; notConfigured: string };
}) {
  return (
    <span
      className={
        configured
          ? "rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400"
          : "rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground"
      }
    >
      {configured ? labels.configured : labels.notConfigured}
    </span>
  );
}
