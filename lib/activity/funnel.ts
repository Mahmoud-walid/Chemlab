import type { ActivityVerb } from "./verbs";

/**
 * The engagement funnel, defined once.
 *
 * #19 asks for "pipelines": how many people get from arriving to passing, and
 * where they fall out. The stages live here rather than in the chart so the
 * chart and the CSV export cannot disagree — two definitions of "reached the
 * exam stage" is two numbers nobody can reconcile.
 *
 * **The honest caveat, stated in the UI and not only here.** Stage one is
 * REGISTERED, not "visitor". We do not record anonymous page views: it would
 * multiply event volume and pull cookie-consent obligations forward, and #19
 * settled on not doing it for v1. A funnel whose first stage is a number we
 * cannot measure would be a funnel with an invented denominator, so the first
 * stage is the first thing we can actually count and the screen says so.
 */

export type FunnelSource =
  /** Counted from `activity_events` by verb. */
  | { kind: "verb"; verbs: ActivityVerb[] }
  /** Counted from `exam_attempts`, which is authoritative for sittings. */
  | { kind: "attempt"; status: "any" | "finished" | "passed" };

export interface FunnelStage {
  key: string;
  source: FunnelSource;
  /**
   * True while nothing in the product emits this stage's verbs yet.
   *
   * A stage with no emitter counts zero, and "0 people read a lesson" is a
   * false claim rather than a measurement — the UI shows "not recorded" for
   * these instead of a number. The flag names the issue that removes it, so
   * it cannot quietly outlive the gap.
   */
  notYetRecorded?: true;
}

/**
 * Ordered, and each stage is a SUBSET of the one before it — that is what
 * makes a conversion rate meaningful. Counting distinct people, never events:
 * one person reading forty lessons is one person who reached that stage.
 */
export const FUNNEL_STAGES: FunnelStage[] = [
  { key: "registered", source: { kind: "verb", verbs: ["auth.signed_up"] } },
  {
    key: "lessonRead",
    source: { kind: "verb", verbs: ["lesson.viewed", "lesson.completed"] },
    // Nothing emits `lesson.viewed` yet: the lessons are two hard-coded
    // static routes, and the `[slug]` model that would carry view tracking
    // is #20's. Instrumenting the two pages now would be work #20 deletes,
    // and reading `headers()` in them would cost their prerendering. Remove
    // this flag when #20 lands.
    notYetRecorded: true,
  },
  { key: "examStarted", source: { kind: "attempt", status: "any" } },
  { key: "examSubmitted", source: { kind: "attempt", status: "finished" } },
  { key: "passed", source: { kind: "attempt", status: "passed" } },
];

export interface FunnelRow {
  key: string;
  people: number;
  /** Mirrors the stage flag, so the renderer needs no second lookup. */
  notYetRecorded: boolean;
  /** Percent of the PREVIOUS stage who reached this one. Null for stage one. */
  conversion: number | null;
  /** Percent of the previous stage who did not. Null for stage one. */
  dropOff: number | null;
  /** Percent of stage one, so the whole shape is readable at a glance. */
  ofFirst: number | null;
}

/**
 * Turns per-stage head counts into the table the chart and the export share.
 *
 * Pure, so the arithmetic can be checked against hand-computed values without
 * a database — which is exactly what #19's acceptance criterion asks for.
 */
export function funnelRows(counts: Record<string, number>): FunnelRow[] {
  const first = counts[FUNNEL_STAGES[0]!.key] ?? 0;

  return FUNNEL_STAGES.map((stage, index) => {
    const people = counts[stage.key] ?? 0;
    // A stage nothing emits is not a denominator either: converting against a
    // structural zero would report a drop-off that never happened, and one
    // gap would swallow every stage after it. The nearest earlier MEASURED
    // stage is the honest comparison.
    const previousStage = lastMeasuredBefore(index);
    const previous =
      previousStage === null ? null : (counts[previousStage.key] ?? 0);

    return {
      key: stage.key,
      people,
      notYetRecorded: stage.notYetRecorded === true,
      // Division by a zero previous stage is not 0% — it is "no answer".
      // Reporting 0% would claim everybody dropped out of a stage nobody
      // reached.
      conversion:
        previous === null || previous === 0 ? null : percent(people, previous),
      dropOff:
        previous === null || previous === 0
          ? null
          : 100 - percent(people, previous),
      ofFirst: index === 0 ? null : first === 0 ? null : percent(people, first),
    };
  });
}

function percent(part: number, whole: number): number {
  return Math.round((part / whole) * 100);
}

/** The nearest earlier stage that something actually emits. */
function lastMeasuredBefore(index: number): FunnelStage | null {
  for (let i = index - 1; i >= 0; i--) {
    const stage = FUNNEL_STAGES[i]!;
    if (!stage.notYetRecorded) return stage;
  }
  return null;
}
