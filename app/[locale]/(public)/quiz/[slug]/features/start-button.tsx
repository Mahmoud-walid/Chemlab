"use client";

import { useState, useTransition } from "react";
import { useRouter } from "@/i18n/navigation";

import { beginAttempt } from "../actions";
import { Button } from "@/components/ui/button";

/**
 * Starts or resumes a sitting.
 *
 * The refusals it can receive — the attempt cap, a cooldown — are decided on
 * the server, so this renders whatever it is told rather than pre-judging.
 * Rendering the button as available and letting the server say no is the
 * honest shape: the client's copy of "how many attempts have I used" is a
 * guess, and a disabled button that is wrong is worse than a message.
 */
export function StartButton({
  slug,
  label,
  failureLabels,
}: {
  slug: string;
  label: string;
  failureLabels: { exhausted: string; coolingDown: string; generic: string };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [problem, setProblem] = useState<string | null>(null);

  function onClick() {
    setProblem(null);
    startTransition(async () => {
      const result = await beginAttempt(slug);
      if (result.ok && result.attemptId) {
        router.push(`/quiz/${slug}/attempt?id=${result.attemptId}`);
        return;
      }
      setProblem(
        result.reason === "attempts_exhausted"
          ? failureLabels.exhausted
          : result.reason === "cooling_down"
            ? failureLabels.coolingDown
            : failureLabels.generic,
      );
    });
  }

  return (
    <div className="space-y-2">
      <Button className="w-full" onClick={onClick} disabled={pending}>
        {label}
      </Button>
      {problem && (
        <p role="alert" className="text-sm text-destructive">
          {problem}
        </p>
      )}
    </div>
  );
}
