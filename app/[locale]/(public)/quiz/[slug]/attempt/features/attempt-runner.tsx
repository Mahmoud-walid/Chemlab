"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "@/i18n/navigation";

import { answerQuestion, finishAttempt } from "../../actions";
import type { Paper } from "@/db/queries/exams/attempts";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { Countdown } from "./countdown";

/** The paper, with its dates already serialised for the client boundary. */
export type SerialisedPaper = Omit<
  Paper,
  "startedAt" | "expiresAt" | "serverNow"
> & {
  startedAt: string;
  expiresAt: string | null;
  serverNow: string;
};

/**
 * Sitting the quiz.
 *
 * Three behaviours are worth stating, because each replaces something the old
 * client-side runner did differently:
 *
 * 1. **Answers save as they are chosen**, so a crash loses at most the
 *    question in hand — the old runner kept the whole attempt in React state
 *    and wrote once, at the end, to `sessionStorage`.
 * 2. **An answer can be changed until submit.** The old UI locked each choice
 *    the moment it was made, which was a consequence of scoring in the browser
 *    rather than a decision anybody took.
 * 3. **Nothing here knows the answers.** No option is styled as correct, and
 *    no explanation is shown, because neither was sent — the paper carries
 *    only what a candidate may see.
 */
export function AttemptRunner({
  paper,
  slug,
  labels,
}: {
  paper: SerialisedPaper;
  slug: string;
  labels: {
    submit: string;
    submitting: string;
    next: string;
    previous: string;
    answeredProgress: string;
    /** `{current}` is filled here; `{total}` is already resolved. */
    position: string;
    /** `{answered}` is filled here. */
    answered: string;
    unanswered: string;
    timeRemaining: string;
    untimed: string;
    timeUp: string;
    saveFailed: string;
    expired: string;
    confirmSubmit: string;
  };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(
      paper.questions.map((question) => [
        question.id,
        question.selectedOptionIds,
      ]),
    ),
  );
  const [problem, setProblem] = useState<string | null>(null);
  // Stamped in an effect rather than during render: reading the clock in a
  // render body is impure, and React may re-render for reasons that have
  // nothing to do with the candidate moving to another question.
  const questionShownAt = useRef(0);
  const submittedRef = useRef(false);

  useEffect(() => {
    questionShownAt.current = Date.now();
  }, [index]);

  const question = paper.questions[index]!;
  const total = paper.questions.length;
  const answeredCount = paper.questions.filter(
    (q) => (selected[q.id] ?? []).length > 0,
  ).length;

  const submit = useCallback(() => {
    // Guarded because the countdown's auto-submit and a click on the button
    // can both arrive: the second would be refused by the server as `not_live`
    // and surface to the candidate as an error on a sitting that worked.
    if (submittedRef.current) return;
    submittedRef.current = true;

    startTransition(async () => {
      const result = await finishAttempt({ attemptId: paper.attemptId });
      if (!result.ok) {
        submittedRef.current = false;
        setProblem(labels.saveFailed);
        return;
      }
      router.replace(`/quiz/${slug}/attempts/${paper.attemptId}`);
    });
  }, [labels.saveFailed, paper.attemptId, router, slug]);

  function choose(optionId: string) {
    const next =
      question.type === "multiple_choice"
        ? toggle(selected[question.id] ?? [], optionId)
        : [optionId];

    setSelected((current) => ({ ...current, [question.id]: next }));
    setProblem(null);

    const spent = elapsedSince(questionShownAt.current);
    startTransition(async () => {
      const result = await answerQuestion({
        attemptId: paper.attemptId,
        questionId: question.id,
        selectedOptionIds: next,
        timeSpentMs: spent,
      });
      if (!result.ok) {
        // The deadline passing mid-sitting is the one failure worth its own
        // message: it is not a network problem and retrying will not help.
        setProblem(
          result.reason === "expired" ? labels.expired : labels.saveFailed,
        );
        if (result.reason === "expired") {
          router.replace(`/quiz/${slug}/attempts/${paper.attemptId}`);
        }
      }
    });
  }

  function go(to: number) {
    setIndex(Math.max(0, Math.min(total - 1, to)));
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 px-4 py-8">
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
          <span className="truncate">{paper.quizTitle}</span>
          <Countdown
            expiresAt={paper.expiresAt}
            serverNow={paper.serverNow}
            label={labels.timeRemaining}
            timeUpLabel={labels.timeUp}
            onExpire={submit}
          />
        </div>
        {/*
          A progress bar with no accessible name is announced as "progress
          bar, 30%" and nothing else. Axe catches it, which is how this was
          found — the old runner had the same bare `<Progress>` on a page
          nothing scanned.
        */}
        <Progress
          value={(answeredCount / Math.max(1, total)) * 100}
          aria-label={labels.answeredProgress}
          className="h-1.5"
        />
        <p className="text-xs text-muted-foreground">
          {labels.position.replace("{current}", String(index + 1))}
          {" · "}
          {labels.answered.replace("{answered}", String(answeredCount))}
        </p>
      </div>

      <div className="space-y-5 rounded-2xl border border-border bg-card p-5 sm:p-6">
        <p className="text-base font-semibold leading-snug text-foreground sm:text-lg">
          {question.prompt}
        </p>

        {/*
          A radiogroup for single choice, a plain group of checkboxes for
          multiple. Native inputs rather than styled buttons: they bring the
          roving focus, the arrow-key behaviour and the announced state that a
          div with `role` would have to reimplement, usually incompletely.
        */}
        <div
          role={question.type === "single_choice" ? "radiogroup" : "group"}
          aria-label={question.prompt}
          className="grid gap-2"
        >
          {question.options.map((option) => {
            const checked = (selected[question.id] ?? []).includes(option.id);
            return (
              <label
                key={option.id}
                data-testid="quiz-option"
                className={cn(
                  "flex w-full cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 text-start text-sm transition-colors",
                  "focus-within:ring-[3px] focus-within:ring-ring/50",
                  checked
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/50 hover:bg-muted",
                )}
              >
                <input
                  type={
                    question.type === "single_choice" ? "radio" : "checkbox"
                  }
                  name={question.id}
                  value={option.id}
                  checked={checked}
                  disabled={pending}
                  onChange={() => choose(option.id)}
                  className="size-4 accent-primary"
                />
                <span>{option.label}</span>
              </label>
            );
          })}
        </div>
      </div>

      {problem && (
        <p
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm"
        >
          {problem}
        </p>
      )}

      <div className="flex items-center justify-between gap-2">
        <Button
          variant="outline"
          onClick={() => go(index - 1)}
          disabled={index === 0}
        >
          {labels.previous}
        </Button>

        {index === total - 1 ? (
          <Button onClick={submit} disabled={pending}>
            {pending ? labels.submitting : labels.submit}
          </Button>
        ) : (
          <Button onClick={() => go(index + 1)}>{labels.next}</Button>
        )}
      </div>

      {answeredCount < total && (
        <p className="text-xs text-muted-foreground">
          {labels.unanswered.replace("{count}", String(total - answeredCount))}
        </p>
      )}
    </div>
  );
}

/**
 * How long the candidate spent on a question.
 *
 * Module scope so the clock is not read inside the component body. The value
 * is analytics only and is stored, never scored — a number the candidate's
 * browser chose can never decide the candidate's mark.
 */
function elapsedSince(startedAt: number): number | undefined {
  return startedAt === 0 ? undefined : Date.now() - startedAt;
}

function toggle(list: string[], value: string): string[] {
  return list.includes(value)
    ? list.filter((entry) => entry !== value)
    : [...list, value];
}
