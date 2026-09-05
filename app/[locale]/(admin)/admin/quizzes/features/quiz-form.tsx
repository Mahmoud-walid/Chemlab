"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { useRouter } from "@/i18n/navigation";
import { createQuiz, updateQuiz } from "../actions";
import { slugify } from "@/lib/admin/lesson-schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/sonner";

export interface QuizFormValues {
  /** Absent when creating. */
  id?: string;
  slug: string;
  title: string;
  description: string;
  difficulty: "easy" | "medium" | "hard";
  category: string;
  position: number;
  timeLimitMinutes: number | null;
  passMarkPercent: number;
  maxAttempts: number | null;
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  /** True when the quiz is live: renaming it breaks existing links. */
  isPublished: boolean;
}

/**
 * The quiz metadata and sitting-rule editor.
 *
 * Questions are edited separately, by their own component with its own save.
 * Folding them into this form would mean one submit that can half-succeed.
 *
 * Deliberately NOT optimistic. A silently reverted form is worse than a slow
 * one: the author would have to work out which of their edits survived.
 */
export function QuizForm({ values }: { values: QuizFormValues }) {
  const t = useTranslations("admin.quizzes");
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [slug, setSlug] = useState(values.slug);
  const [title, setTitle] = useState(values.title);

  const isCreate = values.id === undefined;
  // A published quiz's slug is a URL people already hold. Changing it is
  // allowed — an author may need to fix a typo — but never silently.
  const slugWarning = values.isPublished && slug !== values.slug;

  async function onSubmit(formData: FormData) {
    setPending(true);
    setErrors({});
    setProblem(null);
    try {
      const result = isCreate
        ? await createQuiz(formData)
        : await updateQuiz(values.id!, formData);

      if (result.ok) {
        toast.success({ title: t("saved"), description: "" });
        if (result.slug && result.slug !== values.slug) {
          // A rename moves the editor's own URL, so staying put would leave
          // the author on a page that no longer resolves.
          router.replace(`/admin/quizzes/${result.slug}`);
        } else if (isCreate && result.slug) {
          router.replace(`/admin/quizzes/${result.slug}`);
        } else {
          router.refresh();
        }
        return;
      }

      setErrors(result.errors ?? {});
      setProblem(result.problem ?? null);
      toast.error({ title: t("saveFailed"), description: "" });
    } finally {
      setPending(false);
    }
  }

  const error = (name: string) => errors[name];

  const fieldError = (name: string) =>
    error(name) ? (
      <p id={`${name}-error`} role="alert" className="text-sm text-destructive">
        {error(name)}
      </p>
    ) : null;

  const describedBy = (name: string, hintId?: string) =>
    error(name) ? `${name}-error` : hintId;

  return (
    <form action={onSubmit} className="space-y-6">
      {problem && (
        <p
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm"
        >
          {problem}
        </p>
      )}

      <fieldset className="space-y-4">
        <legend className="text-lg font-semibold">
          {t("sections.details")}
        </legend>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="title">{t("fields.title")}</Label>
            <Input
              id="title"
              name="title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              aria-invalid={Boolean(error("title"))}
              aria-describedby={describedBy("title")}
            />
            {fieldError("title")}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="slug">{t("fields.slug")}</Label>
            <div className="flex gap-2">
              <Input
                id="slug"
                name="slug"
                value={slug}
                onChange={(event) => setSlug(event.target.value)}
                aria-invalid={Boolean(error("slug"))}
                aria-describedby={describedBy("slug", "slug-hint")}
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => setSlug(slugify(title))}
                disabled={!title.trim()}
              >
                {t("suggestSlug")}
              </Button>
            </div>
            {slugWarning && (
              <p
                role="status"
                className="text-sm text-amber-600 dark:text-amber-500"
              >
                {t("slugWarning", { slug: values.slug })}
              </p>
            )}
            {!error("slug") && (
              <p id="slug-hint" className="text-xs text-muted-foreground">
                {t("hints.slug")}
              </p>
            )}
            {fieldError("slug")}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="description">{t("fields.description")}</Label>
          <Textarea
            id="description"
            name="description"
            rows={3}
            defaultValue={values.description}
            aria-invalid={Boolean(error("description"))}
            aria-describedby={describedBy("description")}
          />
          {fieldError("description")}
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="difficulty">{t("fields.difficulty")}</Label>
            {/* A native select: it is a three-option field inside an
                uncontrolled form, and the native element posts its own value
                without a hidden input shadowing it. */}
            <select
              id="difficulty"
              name="difficulty"
              defaultValue={values.difficulty}
              aria-invalid={Boolean(error("difficulty"))}
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <option value="easy">{t("difficulty.easy")}</option>
              <option value="medium">{t("difficulty.medium")}</option>
              <option value="hard">{t("difficulty.hard")}</option>
            </select>
            {fieldError("difficulty")}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="category">{t("fields.category")}</Label>
            <Input
              id="category"
              name="category"
              defaultValue={values.category}
              aria-invalid={Boolean(error("category"))}
              aria-describedby={describedBy("category")}
            />
            {fieldError("category")}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="position">{t("fields.position")}</Label>
            <Input
              id="position"
              name="position"
              inputMode="numeric"
              defaultValue={String(values.position)}
              aria-invalid={Boolean(error("position"))}
              aria-describedby={describedBy("position", "position-hint")}
            />
            {!error("position") && (
              <p id="position-hint" className="text-xs text-muted-foreground">
                {t("hints.position")}
              </p>
            )}
            {fieldError("position")}
          </div>
        </div>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="text-lg font-semibold">{t("sections.rules")}</legend>
        {/* Said plainly rather than left for someone to discover: these
            columns exist and are saved, but nothing reads them yet. */}
        <p className="text-sm text-muted-foreground">{t("hints.rules")}</p>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="timeLimitMinutes">
              {t("fields.timeLimitMinutes")}
            </Label>
            <Input
              id="timeLimitMinutes"
              name="timeLimitMinutes"
              inputMode="numeric"
              defaultValue={
                values.timeLimitMinutes === null
                  ? ""
                  : String(values.timeLimitMinutes)
              }
              aria-invalid={Boolean(error("timeLimitMinutes"))}
              aria-describedby={describedBy(
                "timeLimitMinutes",
                "timeLimitMinutes-hint",
              )}
            />
            {!error("timeLimitMinutes") && (
              <p
                id="timeLimitMinutes-hint"
                className="text-xs text-muted-foreground"
              >
                {t("hints.timeLimitMinutes")}
              </p>
            )}
            {fieldError("timeLimitMinutes")}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="passMarkPercent">
              {t("fields.passMarkPercent")}
            </Label>
            <Input
              id="passMarkPercent"
              name="passMarkPercent"
              inputMode="numeric"
              defaultValue={String(values.passMarkPercent)}
              aria-invalid={Boolean(error("passMarkPercent"))}
              aria-describedby={describedBy("passMarkPercent")}
            />
            {fieldError("passMarkPercent")}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="maxAttempts">{t("fields.maxAttempts")}</Label>
            <Input
              id="maxAttempts"
              name="maxAttempts"
              inputMode="numeric"
              defaultValue={
                values.maxAttempts === null ? "" : String(values.maxAttempts)
              }
              aria-invalid={Boolean(error("maxAttempts"))}
              aria-describedby={describedBy("maxAttempts", "maxAttempts-hint")}
            />
            {!error("maxAttempts") && (
              <p
                id="maxAttempts-hint"
                className="text-xs text-muted-foreground"
              >
                {t("hints.maxAttempts")}
              </p>
            )}
            {fieldError("maxAttempts")}
          </div>
        </div>

        <div className="flex flex-wrap gap-6">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="shuffleQuestions"
              defaultChecked={values.shuffleQuestions}
              className="size-4"
            />
            {t("fields.shuffleQuestions")}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="shuffleOptions"
              defaultChecked={values.shuffleOptions}
              className="size-4"
            />
            {t("fields.shuffleOptions")}
          </label>
        </div>
      </fieldset>

      <Button type="submit" disabled={pending}>
        {pending ? t("saving") : isCreate ? t("create") : t("save")}
      </Button>
    </form>
  );
}
