"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/sonner";
import { isValidBranchPattern } from "@/lib/ci/preferences-input";
import type { CiPreferences } from "@/lib/ci/policy";

/**
 * The Development section: build alerts for the people who work on this
 * repository.
 *
 * Rendered only for holders of `notification:subscribe_ci`, and the API
 * answers 404 without it — so this is a convenience, not the gate.
 *
 * Everything saves as it is changed, like the notification preferences it sits
 * beside, and each save sends ONLY what moved: two tabs open must not have the
 * later save undo the earlier one's unrelated switch.
 *
 * The branch list is the one field with a Save button. It is free text, a
 * half-typed `feat/` is a valid pattern that matches the wrong thing, and
 * saving on every keystroke would write a watch list nobody asked for.
 */

/** `main, feat/*` — the form's shape, not the wire's. */
function parseBranches(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export function CiNotifications() {
  const t = useTranslations("notifications.ci");
  const [preferences, setPreferences] = useState<CiPreferences | null>(null);
  const [branchText, setBranchText] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch("/api/ci/preferences");
        if (!response.ok) return;
        const body = (await response.json()) as CiPreferences;
        if (cancelled) return;
        setPreferences(body);
        setBranchText(body.branches.join(", "));
      } catch {
        /* offline: the controls stay disabled rather than showing a wrong
           state — a build alert switch that lies about being on is the one
           failure this whole feature exists to avoid */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const save = async (patch: Partial<CiPreferences>) => {
    if (!preferences) return;

    const previous = preferences;
    setPreferences({ ...preferences, ...patch });
    setBusy(true);

    try {
      const response = await fetch("/api/ci/preferences", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!response.ok) throw new Error(String(response.status));

      const saved = (await response.json()) as CiPreferences;
      setPreferences(saved);
      setBranchText(saved.branches.join(", "));
      toast.success({ title: t("saved"), description: "" });
    } catch {
      // Back to what the server last told us, so the control never claims a
      // state the server does not hold.
      setPreferences(previous);
      setBranchText(previous.branches.join(", "));
      toast.error({ title: t("failed"), description: "" });
    } finally {
      setBusy(false);
    }
  };

  const parsed = parseBranches(branchText);
  // Checked here as well as on the server so the reason arrives before the
  // save rather than as a rejected request.
  const branchesInvalid =
    parsed.length === 0 || !parsed.every(isValidBranchPattern);
  const branchesChanged =
    preferences !== null && parsed.join(",") !== preferences.branches.join(",");

  const disabled = preferences === null || busy;

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">{t("description")}</p>

      <div className="flex items-center justify-between gap-4">
        <Label htmlFor="ci-enabled" className="text-sm font-normal">
          {t("enabled")}
        </Label>
        <Switch
          id="ci-enabled"
          checked={preferences?.enabled ?? false}
          disabled={disabled}
          onCheckedChange={(next) => void save({ enabled: next })}
        />
      </div>

      {/* Everything below only matters once alerts are on. Shown rather than
          hidden while off, because a section that appears on toggle makes the
          switch look like it did something other than what it did. */}
      <div className="space-y-5" aria-disabled={!preferences?.enabled}>
        <div className="space-y-2">
          <Label htmlFor="ci-branches" className="text-sm font-normal">
            {t("branches")}
          </Label>
          <p className="text-xs text-muted-foreground">
            {t("branchesDescription")}
          </p>
          <div className="flex gap-2">
            <Input
              id="ci-branches"
              value={branchText}
              disabled={disabled}
              aria-invalid={branchesInvalid}
              onChange={(event) => setBranchText(event.target.value)}
              placeholder={t("branchesPlaceholder")}
            />
            <button
              type="button"
              className="rounded-md border px-3 text-sm disabled:opacity-50"
              disabled={disabled || branchesInvalid || !branchesChanged}
              onClick={() => void save({ branches: parsed })}
            >
              {t("branchesSave")}
            </button>
          </div>
          {branchesInvalid && (
            <p role="alert" className="text-xs text-destructive">
              {t("branchesInvalid")}
            </p>
          )}
        </div>

        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="ci-failure" className="text-sm font-normal">
            {t("onFailure")}
          </Label>
          <Switch
            id="ci-failure"
            checked={preferences?.notifyOnFailure ?? true}
            disabled={disabled}
            onCheckedChange={(next) => void save({ notifyOnFailure: next })}
          />
        </div>

        <fieldset className="space-y-2">
          <legend className="text-sm">{t("successPolicy")}</legend>
          <p className="text-xs text-muted-foreground">
            {t("successPolicyDescription")}
          </p>
          <RadioGroup
            value={preferences?.successPolicy ?? "recovery"}
            disabled={disabled}
            onValueChange={(next) =>
              void save({
                successPolicy: next as CiPreferences["successPolicy"],
              })
            }
          >
            {(["never", "recovery", "always"] as const).map((option) => (
              <div key={option} className="flex items-center gap-2">
                <RadioGroupItem value={option} id={`ci-success-${option}`} />
                <Label
                  htmlFor={`ci-success-${option}`}
                  className="text-sm font-normal"
                >
                  {t(`successPolicyOptions.${option}`)}
                </Label>
              </div>
            ))}
          </RadioGroup>
        </fieldset>

        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="ci-cancelled" className="text-sm font-normal">
            {t("onCancelled")}
          </Label>
          <Switch
            id="ci-cancelled"
            checked={preferences?.notifyOnCancelled ?? false}
            disabled={disabled}
            onCheckedChange={(next) => void save({ notifyOnCancelled: next })}
          />
        </div>
      </div>
    </div>
  );
}
