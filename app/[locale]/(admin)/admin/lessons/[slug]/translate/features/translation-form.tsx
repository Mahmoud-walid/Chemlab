"use client";

import { useMemo, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/sonner";
import { TranslationBadge } from "@/components/admin/translation-badge";
import {
  translatableFields,
  translatedCount,
  type TranslatableField,
} from "@/lib/translations/blocks";
import type { LessonBlock } from "@/lib/lessons/blocks";
import type { TranslationState } from "@/lib/translations/state";
import { saveTranslation, setTranslationStatus } from "../actions";

export interface SectionSource {
  id: string;
  position: number;
  heading: string;
  blocks: LessonBlock[];
  values: Record<string, string>;
  translatedHeading: string | null;
}

export interface TranslationFormLabels {
  title: string;
  description: string;
  sectionHeading: string;
  source: string;
  save: string;
  saved: string;
  submit: string;
  publish: string;
  sendBack: string;
  progress: string;
  optional: string;
  states: Record<TranslationState, string>;
  fieldKinds: Record<TranslatableField["kind"], string>;
}

/**
 * Translating a lesson.
 *
 * Every box sits beside the English it answers, because a translator working
 * from a screen that does not show the source is translating from memory.
 *
 * There is no block editor here, and that is deliberate. The translation
 * carries the source's own structure — same blocks, same ids, same order —
 * so the form is a list of the source's text fields with a box each, and the
 * server rebuilds the body from the source. A translation cannot gain, lose
 * or reorder a paragraph because there is no control that would do it.
 */
export function TranslationForm({
  slug,
  locale,
  source,
  translation,
  sections,
  can,
  labels,
}: {
  slug: string;
  locale: string;
  source: { title: string; description: string };
  translation: {
    title: string;
    description: string;
    status: TranslationState;
  } | null;
  sections: SectionSource[];
  can: { write: boolean; review: boolean };
  labels: TranslationFormLabels;
}) {
  const [title, setTitle] = useState(translation?.title ?? "");
  const [description, setDescription] = useState(
    translation?.description ?? "",
  );
  const [headings, setHeadings] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      sections.map((section) => [section.id, section.translatedHeading ?? ""]),
    ),
  );
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.assign({}, ...sections.map((section) => section.values)),
  );
  const [pending, startTransition] = useTransition();

  const fieldsBySection = useMemo(
    () =>
      sections.map((section) => ({
        section,
        fields: translatableFields(section.blocks),
      })),
    [sections],
  );

  const progress = useMemo(() => {
    const totals = sections.map((section) =>
      translatedCount(section.blocks, values),
    );
    return {
      done:
        totals.reduce((sum, part) => sum + part.done, 0) +
        (title.trim() ? 1 : 0) +
        sections.filter((s) => headings[s.id]?.trim()).length,
      total:
        totals.reduce((sum, part) => sum + part.total, 0) + 1 + sections.length,
    };
  }, [sections, values, title, headings]);

  const run = (work: () => Promise<{ ok: boolean; problem?: string }>) =>
    startTransition(async () => {
      const result = await work();
      if (result.ok) toast.success({ title: labels.saved, description: "" });
      else toast.error({ title: result.problem ?? "", description: "" });
    });

  const save = () =>
    run(() =>
      saveTranslation(slug, locale, values, { title, description, headings }),
    );

  return (
    <div className="space-y-6">
      {/* Stacked until there is room for a row. Four buttons plus the badge
          and the progress line do not fit on one line in Arabic, where the
          words are longer — and `justify-between` on a single row pushed the
          buttons off the edge of the panel rather than wrapping them. */}
      <div className="flex flex-col gap-3 rounded-lg border p-4 lg:flex-row lg:flex-wrap lg:items-center lg:justify-between">
        <div className="flex items-center gap-3">
          {translation && (
            <TranslationBadge
              state={translation.status}
              label={labels.states[translation.status]}
            />
          )}
          <span className="text-sm text-muted-foreground">
            {labels.progress
              .replace(
                "{done}",
                String(Math.min(progress.done, progress.total)),
              )
              .replace("{total}", String(progress.total))}
          </span>
        </div>

        <div className="flex min-w-0 flex-wrap gap-2">
          {can.write && (
            <Button type="button" onClick={save} disabled={pending}>
              {labels.save}
            </Button>
          )}
          {can.write && (
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() =>
                run(() => setTranslationStatus(slug, locale, "in_review"))
              }
            >
              {labels.submit}
            </Button>
          )}
          {/* Publishing and sending back are the reviewer's, not the
              translator's. Rendering them for somebody whose click would be
              refused is a worse experience than not showing them. */}
          {can.review && (
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() =>
                run(() => setTranslationStatus(slug, locale, "published"))
              }
            >
              {labels.publish}
            </Button>
          )}
          {can.review && (
            <Button
              type="button"
              variant="ghost"
              disabled={pending}
              onClick={() =>
                run(() => setTranslationStatus(slug, locale, "draft"))
              }
            >
              {labels.sendBack}
            </Button>
          )}
        </div>
      </div>

      <Pair
        label={labels.title}
        sourceLabel={labels.source}
        source={source.title}
      >
        <Input
          id="translation-title"
          value={title}
          dir="auto"
          onChange={(event) => setTitle(event.target.value)}
          disabled={!can.write}
        />
      </Pair>

      <Pair
        label={labels.description}
        sourceLabel={labels.source}
        source={source.description}
      >
        <Textarea
          id="translation-description"
          value={description}
          dir="auto"
          rows={3}
          onChange={(event) => setDescription(event.target.value)}
          disabled={!can.write}
        />
      </Pair>

      {fieldsBySection.map(({ section, fields }) => (
        <section
          key={section.id}
          aria-label={section.heading}
          className="space-y-4 rounded-lg border p-4"
        >
          <Pair
            label={labels.sectionHeading}
            sourceLabel={labels.source}
            source={section.heading}
          >
            <Input
              value={headings[section.id] ?? ""}
              dir="auto"
              onChange={(event) =>
                setHeadings((current) => ({
                  ...current,
                  [section.id]: event.target.value,
                }))
              }
              disabled={!can.write}
            />
          </Pair>

          {fields.map((field) => (
            <Pair
              key={field.key}
              label={`${labels.fieldKinds[field.kind]}${
                field.optional ? ` — ${labels.optional}` : ""
              }`}
              sourceLabel={labels.source}
              source={field.source}
            >
              <Textarea
                value={values[field.key] ?? ""}
                dir="auto"
                rows={2}
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    [field.key]: event.target.value,
                  }))
                }
                disabled={!can.write}
              />
            </Pair>
          ))}
        </section>
      ))}

      {can.write && (
        <Button type="button" onClick={save} disabled={pending}>
          {labels.save}
        </Button>
      )}
    </div>
  );
}

/**
 * One source string and the box that answers it.
 *
 * Side by side on a wide screen, stacked on a narrow one — and the source is
 * `dir="auto"` too, because a lesson may be translated in either direction
 * once a third language exists.
 */
function Pair({
  label,
  sourceLabel,
  source,
  children,
}: {
  label: string;
  sourceLabel: string;
  source: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 sm:gap-4">
      <div className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {sourceLabel}
        </p>
        <p dir="auto" className="whitespace-pre-wrap text-sm">
          {source}
        </p>
      </div>
      <div className="space-y-1">
        <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </Label>
        {children}
      </div>
    </div>
  );
}
