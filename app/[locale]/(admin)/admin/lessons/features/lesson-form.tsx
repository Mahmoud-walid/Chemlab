"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { useRouter } from "@/i18n/navigation";
import { createLesson, updateLesson } from "../actions";
import { slugify } from "@/lib/admin/lesson-schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/sonner";

export interface LessonFormValues {
  /** Absent when creating. */
  id?: string;
  slug: string;
  title: string;
  description: string;
  difficulty: "easy" | "medium" | "hard";
  category: string;
  coverImageUrl: string | null;
  references: string[];
  tags: string[];
  position: number;
  /** True when the lesson is live: renaming it breaks existing links. */
  isPublished: boolean;
}

/**
 * The lesson metadata editor.
 *
 * Metadata and lifecycle only, by design — #16 explicitly leaves the body to
 * the rich-editor issue, and building a second editor here would mean two
 * things to keep in step and one of them wrong.
 *
 * Deliberately NOT optimistic. A silently reverted form is worse than a slow
 * one: the author would have to work out which of their edits survived.
 */
export function LessonForm({ values }: { values: LessonFormValues }) {
  const t = useTranslations("admin.lessons");
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [slug, setSlug] = useState(values.slug);
  const [title, setTitle] = useState(values.title);

  const isCreate = values.id === undefined;
  // A published lesson's slug is a URL people already hold. Changing it is
  // allowed — an author may need to fix a typo — but never silently.
  const slugWarning = values.isPublished && slug !== values.slug;

  async function onSubmit(formData: FormData) {
    setPending(true);
    setErrors({});
    setProblem(null);
    try {
      const result = isCreate
        ? await createLesson(formData)
        : await updateLesson(values.id!, formData);

      if (result.ok) {
        toast.success({ title: t("saved"), description: "" });
        // A rename moves the editor's own URL, so staying put would leave the
        // author on a page that no longer resolves.
        if (result.slug && result.slug !== values.slug) {
          router.replace(`/admin/lessons/${result.slug}`);
        } else if (isCreate && result.slug) {
          router.replace(`/admin/lessons/${result.slug}`);
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

  const describedBy = (name: string, hintId?: string) =>
    error(name) ? `${name}-error` : hintId;

  const fieldError = (name: string) =>
    error(name) ? (
      <p id={`${name}-error`} role="alert" className="text-sm text-destructive">
        {error(name)}
      </p>
    ) : null;

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
            {/* Suggested, not imposed: the author sees what the URL would be
                and decides. Silently rewriting their slug is how a link they
                already shared stops working. */}
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
          {/* A native select, not the Radix one: it is a three-option form
              field inside an uncontrolled form, and the native element posts
              its own value without a hidden input shadowing it. */}
          <select
            id="difficulty"
            name="difficulty"
            defaultValue={values.difficulty}
            aria-invalid={Boolean(error("difficulty"))}
            aria-describedby={describedBy("difficulty")}
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

      <div className="space-y-1.5">
        <Label htmlFor="coverImageUrl">{t("fields.coverImageUrl")}</Label>
        <Input
          id="coverImageUrl"
          name="coverImageUrl"
          type="url"
          defaultValue={values.coverImageUrl ?? ""}
          aria-invalid={Boolean(error("coverImageUrl"))}
          aria-describedby={describedBy("coverImageUrl", "coverImageUrl-hint")}
        />
        {!error("coverImageUrl") && (
          <p id="coverImageUrl-hint" className="text-xs text-muted-foreground">
            {t("hints.coverImageUrl")}
          </p>
        )}
        {fieldError("coverImageUrl")}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="references">{t("fields.references")}</Label>
          <Textarea
            id="references"
            name="references"
            rows={4}
            defaultValue={values.references.join("\n")}
            aria-invalid={Boolean(error("references"))}
            aria-describedby={describedBy("references", "references-hint")}
          />
          <p id="references-hint" className="text-xs text-muted-foreground">
            {t("hints.references")}
          </p>
          {fieldError("references")}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="tags">{t("fields.tags")}</Label>
          <Input
            id="tags"
            name="tags"
            defaultValue={values.tags.join(", ")}
            aria-invalid={Boolean(error("tags"))}
            aria-describedby={describedBy("tags", "tags-hint")}
          />
          <p id="tags-hint" className="text-xs text-muted-foreground">
            {t("hints.tags")}
          </p>
          {fieldError("tags")}
        </div>
      </div>

      <Button type="submit" disabled={pending}>
        {pending ? t("saving") : isCreate ? t("create") : t("save")}
      </Button>
    </form>
  );
}
