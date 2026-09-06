"use client";

import { useMemo, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/sonner";
import { TranslationBadge } from "@/components/admin/translation-badge";
import { incompleteQuestions } from "@/lib/translations/quiz-completeness";
import type { TranslationState } from "@/lib/translations/state";
import {
  saveQuizTranslationAction,
  setQuizTranslationStatusAction,
} from "../actions";

export interface QuestionSource {
  id: string;
  position: number;
  prompt: string;
  explanation: string;
  translatedPrompt: string | null;
  translatedExplanation: string | null;
  options: {
    id: string;
    position: number;
    label: string;
    translatedLabel: string | null;
  }[];
}

export interface QuizTranslationFormLabels {
  title: string;
  description: string;
  questionHeading: string;
  prompt: string;
  explanation: string;
  options: string;
  source: string;
  save: string;
  saved: string;
  submit: string;
  publish: string;
  sendBack: string;
  progress: string;
  incompleteTitle: string;
  incompleteBody: string;
  /** "Question {number}: {parts}" — assembled in the browser. */
  incompleteQuestion: string;
  partNames: { prompt: string; explanation: string; options: string };
  /** Between the part names in that line — "، " in Arabic, ", " in English. */
  partSeparator: string;
  states: Record<TranslationState, string>;
}

/**
 * Translating a quiz.
 *
 * Every box sits beside the English it answers, exactly as the lesson editor
 * does — a translator working from a screen that does not show the source is
 * translating from memory.
 *
 * What this screen has and the lesson one does not is the **options**, and
 * with them a rule: a question and its options are one unit. A question whose
 * options are only partly translated is served to readers entirely in English
 * by `chooseForGroup`, so the translator's work vanishes with no error
 * anywhere. This form therefore says so before the submit rather than after,
 * and the server checks the same rule again — this copy only decides whether
 * a button looks enabled.
 *
 * Which option is CORRECT is nowhere on this screen. A translator renders the
 * words; the answer key is not theirs to see and not theirs to move.
 */
export function QuizTranslationForm({
  slug,
  locale,
  source,
  translation,
  questions,
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
  questions: QuestionSource[];
  can: { write: boolean; review: boolean };
  labels: QuizTranslationFormLabels;
}) {
  const [title, setTitle] = useState(translation?.title ?? "");
  const [description, setDescription] = useState(
    translation?.description ?? "",
  );
  const [prompts, setPrompts] = useState<Record<string, string>>(() =>
    Object.fromEntries(questions.map((q) => [q.id, q.translatedPrompt ?? ""])),
  );
  const [explanations, setExplanations] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      questions.map((q) => [q.id, q.translatedExplanation ?? ""]),
    ),
  );
  const [optionLabels, setOptionLabels] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      questions.flatMap((q) =>
        q.options.map((o) => [o.id, o.translatedLabel ?? ""]),
      ),
    ),
  );
  const [pending, startTransition] = useTransition();

  // The same pure rule the server applies, so the two cannot drift into
  // disagreeing about what "finished" means.
  const drafts = useMemo(
    () =>
      questions.map((question) => ({
        id: question.id,
        prompt: prompts[question.id] ?? "",
        explanation: explanations[question.id] ?? "",
        options: question.options.map((option) => ({
          id: option.id,
          label: optionLabels[option.id] ?? "",
        })),
      })),
    [questions, prompts, explanations, optionLabels],
  );

  const incomplete = useMemo(() => incompleteQuestions(drafts), [drafts]);

  const progress = useMemo(() => {
    // Every box on the screen, counted the same way: two for the quiz, two per
    // question, one per option.
    const boxes = drafts.flatMap((draft) => [
      draft.prompt,
      draft.explanation,
      ...draft.options.map((option) => option.label),
    ]);
    return {
      done:
        boxes.filter((value) => value.trim()).length +
        (title.trim() ? 1 : 0) +
        (description.trim() ? 1 : 0),
      total: boxes.length + 2,
    };
  }, [drafts, title, description]);

  const run = (work: () => Promise<{ ok: boolean; problem?: string }>) =>
    startTransition(async () => {
      const result = await work();
      if (result.ok) toast.success({ title: labels.saved, description: "" });
      else toast.error({ title: result.problem ?? "", description: "" });
    });

  const save = () =>
    run(() =>
      saveQuizTranslationAction(slug, locale, {
        title,
        description,
        prompts,
        explanations,
        optionLabels,
      }),
    );

  const partName = (part: "prompt" | "explanation" | "options") =>
    labels.partNames[part];

  return (
    <div className="space-y-6">
      {/* Stacked until there is room for a row, for the same reason the lesson
          editor is: four buttons plus the badge and the progress line do not
          fit on one line in Arabic, where the words are longer. */}
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
              // Disabled rather than refused: the panel below already says
              // which questions are unfinished, so a button that could only
              // fail is noise. The server checks the same rule regardless.
              disabled={pending || incomplete.length > 0}
              onClick={() =>
                run(() =>
                  setQuizTranslationStatusAction(slug, locale, "in_review"),
                )
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
              disabled={pending || incomplete.length > 0}
              onClick={() =>
                run(() =>
                  setQuizTranslationStatusAction(slug, locale, "published"),
                )
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
                run(() => setQuizTranslationStatusAction(slug, locale, "draft"))
              }
            >
              {labels.sendBack}
            </Button>
          )}
        </div>
      </div>

      {incomplete.length > 0 && (
        <div
          role="status"
          className="space-y-1 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
        >
          <p className="font-medium">{labels.incompleteTitle}</p>
          <p className="text-muted-foreground">{labels.incompleteBody}</p>
          <ul className="list-inside list-disc">
            {incomplete.map((question) => (
              <li key={question.id}>
                {labels.incompleteQuestion
                  .replace("{number}", String(question.number))
                  .replace(
                    "{parts}",
                    question.parts.map(partName).join(labels.partSeparator),
                  )}
              </li>
            ))}
          </ul>
        </div>
      )}

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

      {questions.map((question, index) => (
        <section
          key={question.id}
          aria-label={labels.questionHeading.replace(
            "{number}",
            String(index + 1),
          )}
          className="space-y-4 rounded-lg border p-4"
        >
          <h2 className="font-semibold">
            {labels.questionHeading.replace("{number}", String(index + 1))}
          </h2>

          <Pair
            label={labels.prompt}
            sourceLabel={labels.source}
            source={question.prompt}
          >
            <Textarea
              value={prompts[question.id] ?? ""}
              dir="auto"
              rows={2}
              onChange={(event) =>
                setPrompts((current) => ({
                  ...current,
                  [question.id]: event.target.value,
                }))
              }
              disabled={!can.write}
            />
          </Pair>

          <Pair
            label={labels.explanation}
            sourceLabel={labels.source}
            source={question.explanation}
          >
            <Textarea
              value={explanations[question.id] ?? ""}
              dir="auto"
              rows={2}
              onChange={(event) =>
                setExplanations((current) => ({
                  ...current,
                  [question.id]: event.target.value,
                }))
              }
              disabled={!can.write}
            />
          </Pair>

          {/* Grouped under one heading rather than listed as loose fields:
              the options are what makes this question answerable, and seeing
              them together is what lets a translator keep them parallel. */}
          <div className="space-y-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {labels.options}
            </p>
            {question.options.map((option) => (
              <Pair
                key={option.id}
                label={labels.options}
                sourceLabel={labels.source}
                source={option.label}
              >
                <Input
                  value={optionLabels[option.id] ?? ""}
                  dir="auto"
                  onChange={(event) =>
                    setOptionLabels((current) => ({
                      ...current,
                      [option.id]: event.target.value,
                    }))
                  }
                  disabled={!can.write}
                />
              </Pair>
            ))}
          </div>
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
 * `dir="auto"` too, because a quiz may be translated in either direction once
 * a third language exists.
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
