"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { updateElement } from "../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/sonner";

export interface ElementFormValues {
  number: number;
  symbol: string;
  name: string;
  category: string;
  phase: string;
  atomicMass: number;
  period: number;
  xpos: number;
  ypos: number;
  density: number | null;
  melt: number | null;
  boil: number | null;
  molarHeat: number | null;
  electronAffinity: number | null;
  electronegativityPauling: number | null;
  electronConfiguration: string;
  electronConfigurationSemantic: string;
  shells: number[];
  ionizationEnergies: number[];
  summary: string;
  source: string;
  appearance: string | null;
  color: string | null;
  spectralImg: string | null;
  discoveredBy: string | null;
  namedBy: string | null;
}

type FieldKey = Exclude<keyof ElementFormValues, "number">;

/**
 * The element editor.
 *
 * Grouped in tabs because 25 fields in one column is a scroll, not a form —
 * and because the groupings are how a chemist thinks about an element rather
 * than how the table stores it.
 *
 * Deliberately NOT optimistic. A silently reverted 25-field form is worse than
 * a slow one: the operator would have to work out which of their edits
 * survived. Row-level toggles elsewhere can afford optimism; this cannot.
 */
export function ElementForm({ values }: { values: ElementFormValues }) {
  const t = useTranslations("admin.elements");
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problems, setProblems] = useState<string[]>([]);

  async function onSubmit(formData: FormData) {
    setPending(true);
    setErrors({});
    setProblems([]);
    try {
      // The atomic number comes from the closure, not the form: it is the
      // natural key, and a hidden field would let it be edited.
      const result = await updateElement(values.number, formData);
      if (result.ok) {
        toast.success({ title: t("saved"), description: "" });
        return;
      }
      setErrors(result.errors ?? {});
      setProblems(result.problems ?? []);
      toast.error({ title: t("saveFailed"), description: "" });
    } finally {
      setPending(false);
    }
  }

  /** A text or numeric field. `optional` fields render empty for null. */
  const field = (
    name: FieldKey,
    options: { optional?: boolean; numeric?: boolean; hint?: string } = {},
  ) => {
    const value = values[name];
    const defaultValue = Array.isArray(value)
      ? value.join(", ")
      : (value ?? "");
    const error = errors[name];

    return (
      <div className="space-y-1.5" key={name}>
        <Label htmlFor={name}>{t(`fields.${name}` as never)}</Label>
        <Input
          id={name}
          name={name}
          defaultValue={String(defaultValue)}
          // `inputMode` rather than `type="number"`: a number input silently
          // discards what it cannot parse, which would turn a typo into a
          // blank field and a blank field into "unknown".
          inputMode={options.numeric ? "decimal" : undefined}
          aria-invalid={Boolean(error)}
          aria-describedby={
            error ? `${name}-error` : options.hint ? `${name}-hint` : undefined
          }
        />
        {options.hint && !error && (
          <p id={`${name}-hint`} className="text-xs text-muted-foreground">
            {options.hint}
          </p>
        )}
        {error && (
          <p
            id={`${name}-error`}
            role="alert"
            className="text-sm text-destructive"
          >
            {error}
          </p>
        )}
      </div>
    );
  };

  const optionalHint = t("hints.optional");
  const vectorHint = t("hints.vector");

  return (
    <form action={onSubmit} className="space-y-6">
      {problems.length > 0 && (
        <div
          role="alert"
          className="space-y-1 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm"
        >
          {problems.map((problem) => (
            <p key={problem}>{problem}</p>
          ))}
        </div>
      )}

      {/* `forceMount` on every panel, with the inactive ones hidden by CSS.
          Radix unmounts an inactive TabsContent by default, which for a FORM
          means the fields you are not looking at are not in the DOM — so a
          submit from the Editorial tab posts without a symbol, a name or an
          atomic mass, and fails validation every time. */}
      <Tabs defaultValue="identity">
        <TabsList>
          <TabsTrigger value="identity">{t("tabs.identity")}</TabsTrigger>
          <TabsTrigger value="physical">{t("tabs.physical")}</TabsTrigger>
          <TabsTrigger value="electronic">{t("tabs.electronic")}</TabsTrigger>
          <TabsTrigger value="editorial">{t("tabs.editorial")}</TabsTrigger>
        </TabsList>

        <TabsContent
          forceMount
          value="identity"
          className="data-[state=inactive]:hidden grid gap-4 pt-4 sm:grid-cols-2"
        >
          {field("symbol")}
          {field("name")}
          {field("category")}
          {field("period", { numeric: true })}
          {field("xpos", { numeric: true })}
          {field("ypos", { numeric: true })}
        </TabsContent>

        <TabsContent
          forceMount
          value="physical"
          className="data-[state=inactive]:hidden grid gap-4 pt-4 sm:grid-cols-2"
        >
          {field("atomicMass", { numeric: true })}
          {field("phase")}
          {field("density", { numeric: true, hint: optionalHint })}
          {field("melt", { numeric: true, hint: optionalHint })}
          {field("boil", { numeric: true, hint: optionalHint })}
          {field("molarHeat", { numeric: true, hint: optionalHint })}
          {field("appearance", { hint: optionalHint })}
          {field("color", { hint: optionalHint })}
        </TabsContent>

        <TabsContent
          forceMount
          value="electronic"
          className="data-[state=inactive]:hidden grid gap-4 pt-4 sm:grid-cols-2"
        >
          {field("electronConfiguration")}
          {field("electronConfigurationSemantic")}
          {field("shells", { hint: vectorHint })}
          {field("ionizationEnergies", { hint: vectorHint })}
          {field("electronAffinity", { numeric: true, hint: optionalHint })}
          {field("electronegativityPauling", {
            numeric: true,
            hint: optionalHint,
          })}
        </TabsContent>

        <TabsContent
          forceMount
          value="editorial"
          className="data-[state=inactive]:hidden space-y-4 pt-4"
        >
          <div className="space-y-1.5">
            <Label htmlFor="summary">{t("fields.summary")}</Label>
            <Textarea
              id="summary"
              name="summary"
              rows={5}
              defaultValue={values.summary}
              aria-invalid={Boolean(errors.summary)}
            />
            {errors.summary && (
              <p role="alert" className="text-sm text-destructive">
                {errors.summary}
              </p>
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {field("discoveredBy", { hint: optionalHint })}
            {field("namedBy", { hint: optionalHint })}
            {field("source")}
            {field("spectralImg", { hint: optionalHint })}
          </div>
        </TabsContent>
      </Tabs>

      <Button type="submit" disabled={pending}>
        {pending ? t("saving") : t("save")}
      </Button>
    </form>
  );
}
