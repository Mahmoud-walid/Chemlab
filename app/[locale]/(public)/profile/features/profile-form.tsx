"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { updateProfile } from "../actions";
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
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/sonner";

export function ProfileForm({
  displayName,
  bio,
  locale,
}: {
  displayName: string;
  bio: string;
  locale: "en" | "ar";
}) {
  const t = useTranslations("auth");
  // Language endonyms already live in the `locale` namespace, where a
  // translator can override them; they are not new strings.
  const tLocale = useTranslations("locale");
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  // Controlled so the Select posts a value: a shadcn Select is not a native
  // <select>, and an uncontrolled one submits nothing.
  const [selectedLocale, setSelectedLocale] = useState(locale);

  async function onSubmit(formData: FormData) {
    setPending(true);
    setErrors({});
    try {
      const result = await updateProfile(formData);
      if (result.ok) {
        toast.success({ title: t("profileSaved"), description: "" });
      } else {
        setErrors(result.errors ?? {});
        toast.error({ title: t("profileSaveFailed"), description: "" });
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <form action={onSubmit} className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="displayName">{t("displayName")}</Label>
        <Input
          id="displayName"
          name="displayName"
          defaultValue={displayName}
          maxLength={80}
          required
          aria-invalid={Boolean(errors.displayName)}
          aria-describedby={
            errors.displayName ? "displayName-error" : undefined
          }
        />
        {errors.displayName && (
          <p
            id="displayName-error"
            role="alert"
            className="text-sm text-destructive"
          >
            {errors.displayName}
          </p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="bio">{t("bio")}</Label>
        <Textarea
          id="bio"
          name="bio"
          defaultValue={bio}
          maxLength={500}
          rows={4}
          placeholder={t("bioPlaceholder")}
          aria-invalid={Boolean(errors.bio)}
          aria-describedby={errors.bio ? "bio-error" : undefined}
        />
        {errors.bio && (
          <p id="bio-error" role="alert" className="text-sm text-destructive">
            {errors.bio}
          </p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="locale">{t("language")}</Label>
        <input type="hidden" name="locale" value={selectedLocale} />
        <Select
          value={selectedLocale}
          onValueChange={(value) => setSelectedLocale(value as "en" | "ar")}
        >
          <SelectTrigger id="locale" className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="en">{tLocale("en")}</SelectItem>
            <SelectItem value="ar">{tLocale("ar")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Button type="submit" disabled={pending}>
        {pending ? t("saving") : t("saveChanges")}
      </Button>
    </form>
  );
}
