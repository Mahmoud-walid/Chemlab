"use client";

import { useState, useTransition } from "react";
import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { saveQuizQuestions } from "../actions";
import { MAX_OPTIONS, MIN_OPTIONS, moved } from "@/lib/admin/quiz-schema";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/sonner";

export interface EditableOption {
  /** Absent for an option the author has just added. */
  id?: string;
  label: string;
  /** Stable across reorders, so React keeps the input the author is typing in. */
  key: string;
}

export interface EditableQuestion {
  id?: string;
  prompt: string;
  explanation: string;
  points: number;
  options: EditableOption[];
  /** Index into `options`; -1 when no answer is marked. */
  correctIndex: number;
  key: string;
}

let counter = 0;
const nextKey = () => `new-${counter++}`;

export function blankQuestion(): EditableQuestion {
  return {
    prompt: "",
    explanation: "",
    points: 1,
    options: [
      { label: "", key: nextKey() },
      { label: "", key: nextKey() },
    ],
    correctIndex: 0,
    key: nextKey(),
  };
}

/**
 * The question editor.
 *
 * The whole list is held in client state and saved in one action, rather than
 * a request per row. Reordering, adding and deleting are one edit as far as
 * the author is concerned — and three separate actions would let a quiz end up
 * half-reordered, which the unique index on (quiz_id, position) would then
 * refuse halfway through.
 *
 * Not optimistic, deliberately. A silently reverted question list is worse than
 * a slow save: the author would have to work out which of their edits survived.
 *
 * `key` is a client-side identity that survives reordering. Using the array
 * index would make React reuse the input the author is typing in for a
 * different question the moment they move one.
 */
export function QuestionEditor({
  quizId,
  initial,
  canEdit,
}: {
  quizId: string;
  initial: EditableQuestion[];
  canEdit: boolean;
}) {
  const t = useTranslations("admin.quizzes.questions");
  const [questions, setQuestions] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [removing, setRemoving] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();

  const update = (index: number, patch: Partial<EditableQuestion>) => {
    setQuestions((current) =>
      current.map((question, i) =>
        i === index ? { ...question, ...patch } : question,
      ),
    );
  };

  const updateOption = (
    questionIndex: number,
    optionIndex: number,
    label: string,
  ) => {
    setQuestions((current) =>
      current.map((question, i) =>
        i === questionIndex
          ? {
              ...question,
              options: question.options.map((option, j) =>
                j === optionIndex ? { ...option, label } : option,
              ),
            }
          : question,
      ),
    );
  };

  const addOption = (questionIndex: number) => {
    setQuestions((current) =>
      current.map((question, i) =>
        i === questionIndex && question.options.length < MAX_OPTIONS
          ? {
              ...question,
              options: [...question.options, { label: "", key: nextKey() }],
            }
          : question,
      ),
    );
  };

  const removeOption = (questionIndex: number, optionIndex: number) => {
    setQuestions((current) =>
      current.map((question, i) => {
        if (i !== questionIndex) return question;
        if (question.options.length <= MIN_OPTIONS) return question;
        const options = question.options.filter((_, j) => j !== optionIndex);
        // The marked answer follows the option it was on. Removing an earlier
        // option would otherwise shift the answer onto its neighbour, which is
        // a wrong answer key nobody would notice.
        let correctIndex = question.correctIndex;
        if (optionIndex === correctIndex) correctIndex = -1;
        else if (optionIndex < correctIndex) correctIndex -= 1;
        return { ...question, options, correctIndex };
      }),
    );
  };

  const move = (index: number, delta: number) => {
    setQuestions((current) => moved(current, index, index + delta));
  };

  async function onSave() {
    setErrors({});
    setProblem(null);
    startTransition(async () => {
      const result = await saveQuizQuestions(
        quizId,
        questions.map((question) => ({
          id: question.id,
          prompt: question.prompt,
          explanation: question.explanation,
          points: question.points,
          options: question.options.map((option) => ({
            id: option.id,
            label: option.label,
          })),
          correctIndex: question.correctIndex,
        })),
      );

      if (result.ok) {
        toast.success({ title: t("saved"), description: "" });
        return;
      }
      setErrors(result.errors ?? {});
      setProblem(result.problem ?? null);
      toast.error({ title: t("saveFailed"), description: "" });
    });
  }

  const errorFor = (path: string) => errors[path];

  return (
    <section aria-labelledby="questions-heading" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="questions-heading" className="text-lg font-semibold">
          {t("heading")}
        </h2>
        {canEdit && (
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                setQuestions((current) => [...current, blankQuestion()])
              }
            >
              <Plus className="size-4" aria-hidden />
              {t("add")}
            </Button>
            <Button type="button" onClick={onSave} disabled={pending}>
              {pending ? t("saving") : t("save")}
            </Button>
          </div>
        )}
      </div>

      {problem && (
        <p
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm"
        >
          {problem}
        </p>
      )}

      {questions.length === 0 && (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          {t("empty")}
        </p>
      )}

      <ol className="space-y-4">
        {questions.map((question, index) => (
          <li key={question.key} className="space-y-3 rounded-lg border p-4">
            <div className="flex items-start justify-between gap-2">
              <h3 className="font-medium">
                {t("number", { number: index + 1 })}
              </h3>
              {canEdit && (
                <div className="flex gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={t("moveUp", { number: index + 1 })}
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  >
                    <ChevronUp className="size-4" aria-hidden />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={t("moveDown", { number: index + 1 })}
                    disabled={index === questions.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    <ChevronDown className="size-4" aria-hidden />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={t("remove", { number: index + 1 })}
                    onClick={() => setRemoving(index)}
                  >
                    <Trash2 className="size-4 text-destructive" aria-hidden />
                  </Button>
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor={`prompt-${question.key}`}>{t("prompt")}</Label>
              <Textarea
                id={`prompt-${question.key}`}
                rows={2}
                value={question.prompt}
                disabled={!canEdit}
                aria-invalid={Boolean(errorFor(`${index}.prompt`))}
                onChange={(event) =>
                  update(index, { prompt: event.target.value })
                }
              />
              {errorFor(`${index}.prompt`) && (
                <p role="alert" className="text-sm text-destructive">
                  {errorFor(`${index}.prompt`)}
                </p>
              )}
            </div>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">{t("options")}</legend>
              {/* Radio buttons, one group per question: the stored model holds
                  a single correct option (`correct_option_id`). Checkboxes
                  would offer a choice the schema cannot keep — see Q33. */}
              {question.options.map((option, optionIndex) => (
                <div key={option.key} className="flex items-center gap-2">
                  <input
                    type="radio"
                    name={`correct-${question.key}`}
                    checked={question.correctIndex === optionIndex}
                    disabled={!canEdit}
                    aria-label={t("markCorrect", { number: optionIndex + 1 })}
                    onChange={() =>
                      update(index, { correctIndex: optionIndex })
                    }
                    className="size-4"
                  />
                  <Input
                    value={option.label}
                    disabled={!canEdit}
                    aria-label={t("optionLabel", { number: optionIndex + 1 })}
                    aria-invalid={Boolean(
                      errorFor(`${index}.options.${optionIndex}.label`),
                    )}
                    onChange={(event) =>
                      updateOption(index, optionIndex, event.target.value)
                    }
                  />
                  {canEdit && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={t("removeOption", {
                        number: optionIndex + 1,
                      })}
                      disabled={question.options.length <= MIN_OPTIONS}
                      onClick={() => removeOption(index, optionIndex)}
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </Button>
                  )}
                </div>
              ))}

              {errorFor(`${index}.correctIndex`) && (
                <p role="alert" className="text-sm text-destructive">
                  {errorFor(`${index}.correctIndex`)}
                </p>
              )}
              {errorFor(`${index}.options`) && (
                <p role="alert" className="text-sm text-destructive">
                  {errorFor(`${index}.options`)}
                </p>
              )}
              {question.options.map((option, optionIndex) =>
                errorFor(`${index}.options.${optionIndex}.label`) ? (
                  <p
                    key={`${option.key}-error`}
                    role="alert"
                    className="text-sm text-destructive"
                  >
                    {errorFor(`${index}.options.${optionIndex}.label`)}
                  </p>
                ) : null,
              )}

              {canEdit && question.options.length < MAX_OPTIONS && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => addOption(index)}
                >
                  <Plus className="size-4" aria-hidden />
                  {t("addOption")}
                </Button>
              )}
            </fieldset>

            <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
              <div className="space-y-1.5">
                <Label htmlFor={`explanation-${question.key}`}>
                  {t("explanation")}
                </Label>
                <Textarea
                  id={`explanation-${question.key}`}
                  rows={2}
                  value={question.explanation}
                  disabled={!canEdit}
                  aria-invalid={Boolean(errorFor(`${index}.explanation`))}
                  onChange={(event) =>
                    update(index, { explanation: event.target.value })
                  }
                />
                {errorFor(`${index}.explanation`) && (
                  <p role="alert" className="text-sm text-destructive">
                    {errorFor(`${index}.explanation`)}
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`points-${question.key}`}>{t("points")}</Label>
                <Input
                  id={`points-${question.key}`}
                  inputMode="numeric"
                  className="w-24"
                  value={String(question.points)}
                  disabled={!canEdit}
                  aria-invalid={Boolean(errorFor(`${index}.points`))}
                  onChange={(event) =>
                    update(index, { points: Number(event.target.value) || 0 })
                  }
                />
                {errorFor(`${index}.points`) && (
                  <p role="alert" className="text-sm text-destructive">
                    {errorFor(`${index}.points`)}
                  </p>
                )}
              </div>
            </div>
          </li>
        ))}
      </ol>

      <AlertDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("confirmRemoveTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("confirmRemoveBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (removing === null) return;
                setQuestions((current) =>
                  current.filter((_, i) => i !== removing),
                );
                setRemoving(null);
              }}
            >
              {t("confirmRemoveAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
