"use client";

import { useCallback, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";

import { BlockRenderer } from "@/components/lessons/block-renderer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import {
  readingTimeMinutes,
  readingTimeSeconds,
} from "@/lib/lessons/reading-time";
import type { LessonBlock } from "@/lib/lessons/blocks";
import { saveLessonBody } from "../actions";
import {
  SaveIndicator,
  SectionEditor,
  useAutosave,
  type SaveState,
} from "./section-editor";

/**
 * The lesson body editor.
 *
 * The preview renders through `BlockRenderer` — the SAME component the public
 * page uses, not a lookalike. A preview built from a second renderer is a
 * preview that can be right while the page is wrong, which is worse than no
 * preview: it is a promise about how the lesson will look, and only one of the
 * two would be keeping it.
 */

export interface EditableSectionInput {
  id: string;
  heading: string;
  blocks: LessonBlock[];
}

export interface BodyEditorLabels {
  heading: string;
  headingPlaceholder: string;
  bodyPlaceholder: string;
  bodyLabel: string;
  addSection: string;
  removeSection: string;
  preview: string;
  readingTime: string;
  empty: string;
  save: SaveState extends never ? never : Record<SaveState, string>;
}

export function BodyEditor({
  slug,
  initial,
  labels,
}: {
  slug: string;
  initial: EditableSectionInput[];
  labels: BodyEditorLabels;
}) {
  const [sections, setSections] = useState<EditableSectionInput[]>(initial);

  const save = useCallback(async () => {
    const result = await saveLessonBody(
      slug,
      sections.map((section) => ({
        heading: section.heading,
        blocks: section.blocks,
      })),
    );

    if (!result.ok) {
      toast.error({ title: result.problem ?? "", description: "" });
      return false;
    }
    return true;
  }, [slug, sections]);

  const [saveState, markDirty] = useAutosave(save);

  const update = (id: string, patch: Partial<EditableSectionInput>) => {
    setSections((current) =>
      current.map((section) =>
        section.id === id ? { ...section, ...patch } : section,
      ),
    );
    markDirty();
  };

  const addSection = () => {
    setSections((current) => [
      ...current,
      {
        id: `new-${current.length + 1}-${Date.now()}`,
        heading: "",
        blocks: [],
      },
    ]);
    markDirty();
  };

  const removeSection = (id: string) => {
    setSections((current) => current.filter((section) => section.id !== id));
    markDirty();
  };

  // Computed the same way the server computes it on save, from the same
  // function — so the number shown while typing is the number that gets
  // stored, rather than an estimate of it.
  const minutes = useMemo(
    () =>
      readingTimeMinutes(
        readingTimeSeconds(sections.flatMap((section) => section.blocks)),
      ),
    [sections],
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SaveIndicator state={saveState} labels={labels.save} />
        <p className="text-sm text-muted-foreground">
          {labels.readingTime.replace("{minutes}", String(minutes))}
        </p>
      </div>

      <div className="gap-8 lg:grid lg:grid-cols-2">
        <div className="space-y-6">
          {sections.map((section, index) => {
            // Built outside the JSX: the lint rule forbids template literals
            // in markup, and a label assembled inline is also harder to see.
            const headingLabel = `${labels.heading} ${index + 1}`;
            const bodyLabel = `${labels.bodyLabel} ${index + 1}`;

            return (
              <section key={section.id} className="space-y-2">
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <label
                      htmlFor={`heading-${section.id}`}
                      className="text-sm font-medium"
                    >
                      {headingLabel}
                    </label>
                    <Input
                      id={`heading-${section.id}`}
                      value={section.heading}
                      placeholder={labels.headingPlaceholder}
                      onChange={(event) =>
                        update(section.id, { heading: event.target.value })
                      }
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removeSection(section.id)}
                    aria-label={`${labels.removeSection}: ${section.heading}`}
                  >
                    <Trash2 aria-hidden="true" className="size-4" />
                  </Button>
                </div>

                <SectionEditor
                  blocks={section.blocks}
                  placeholder={labels.bodyPlaceholder}
                  label={bodyLabel}
                  onChange={(blocks) => update(section.id, { blocks })}
                />
              </section>
            );
          })}

          <Button
            type="button"
            variant="outline"
            onClick={addSection}
            className="gap-2"
          >
            <Plus aria-hidden="true" className="size-4" />
            {labels.addSection}
          </Button>
        </div>

        <div className="mt-8 lg:mt-0">
          <h2 className="mb-3 text-sm font-medium">{labels.preview}</h2>
          <div className="rounded-lg border p-6">
            {sections.length === 0 ? (
              <p className="text-sm text-muted-foreground">{labels.empty}</p>
            ) : (
              sections.map((section) => (
                <section key={section.id}>
                  <h3 className="mt-8 text-xl font-bold first:mt-0">
                    {section.heading}
                  </h3>
                  {/* The public renderer, not a copy of it. */}
                  <BlockRenderer blocks={section.blocks} />
                </section>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
