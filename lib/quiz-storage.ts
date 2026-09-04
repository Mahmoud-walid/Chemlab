import { type QuizAttempt } from "@/types/quiz";
import {
  readStoredValue,
  removeStoredValue,
  writeStoredValue,
} from "@/lib/browser-storage";

export const QUIZ_STORAGE_KEY = "chemlab_quiz_results";

// ── Read ──
export function parseAttempts(raw: string | null): QuizAttempt[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as QuizAttempt[]) : [];
  } catch {
    return [];
  }
}

export function getAttempts(): QuizAttempt[] {
  return parseAttempts(readStoredValue("session", QUIZ_STORAGE_KEY));
}

export function getAttemptBySlug(slug: string): QuizAttempt | null {
  return getAttempts().find((a) => a.slug === slug) ?? null;
}

// ── Write ──
export function saveAttempt(attempt: QuizAttempt): void {
  if (typeof window === "undefined") return;
  const existing = getAttempts().filter((a) => a.slug !== attempt.slug);
  writeStoredValue(
    "session",
    QUIZ_STORAGE_KEY,
    JSON.stringify([attempt, ...existing]),
  );
}

// ── Clear ──
export function clearAttempts(): void {
  if (typeof window === "undefined") return;
  removeStoredValue("session", QUIZ_STORAGE_KEY);
}

// ── Helpers ──
export function percentage(score: number, total: number): number {
  return total === 0 ? 0 : Math.round((score / total) * 100);
}

/** Keys into the `quiz.grade` message namespace. */
export type GradeKey = "excellent" | "good" | "needsWork" | "keepStudying";

/**
 * Grade band for a percentage.
 *
 * Returns a translation KEY, not a display string — the caller translates it.
 * A helper in lib/ has no locale, and returning English here is what made the
 * results page untranslatable.
 */
export function gradeLabel(pct: number): {
  key: GradeKey;
  className: string;
} {
  if (pct >= 90)
    return { key: "excellent", className: "text-green-600 dark:text-green-400" };
  if (pct >= 75) return { key: "good", className: "text-chart-2" };
  if (pct >= 50)
    return {
      key: "needsWork",
      className: "text-yellow-600 dark:text-yellow-400",
    };
  return { key: "keepStudying", className: "text-destructive" };
}
