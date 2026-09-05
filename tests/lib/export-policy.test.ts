import { describe, expect, it } from "vitest";

import {
  DATASETS,
  EXPORTS_PER_WINDOW,
  EXPORT_DATASETS,
  EXPORT_WINDOW_MS,
  decideExportRate,
  isExportDataset,
} from "@/lib/exports/policy";
import { allPermissionNames } from "@/db/seed/rbac";

const NOW = new Date("2026-09-05T12:00:00Z");

function agesAgo(...minutes: number[]): Date[] {
  return minutes.map((m) => new Date(NOW.getTime() - m * 60 * 1000));
}

describe("the dataset catalogue", () => {
  it("gates every dataset on a permission that actually exists", () => {
    const known = new Set(allPermissionNames());
    for (const dataset of EXPORT_DATASETS) {
      const spec = DATASETS[dataset];
      expect(known, `${dataset} permission`).toContain(spec.permission);
      if (spec.piiPermission) {
        expect(known, `${dataset} pii permission`).toContain(
          spec.piiPermission,
        );
      }
    }
  });

  it("caps every dataset", () => {
    for (const dataset of EXPORT_DATASETS) {
      expect(DATASETS[dataset].maxRows).toBeGreaterThan(0);
    }
  });

  it("rejects a dataset name from the query string", () => {
    expect(isExportDataset("events")).toBe(true);
    expect(isExportDataset("users")).toBe(false);
    expect(isExportDataset("")).toBe(false);
  });
});

describe("decideExportRate", () => {
  it("allows the first export", () => {
    expect(decideExportRate([], NOW)).toEqual({
      allowed: true,
      retryAfterSeconds: 0,
      remaining: EXPORTS_PER_WINDOW - 1,
    });
  });

  it("counts down the remaining allowance", () => {
    expect(decideExportRate(agesAgo(1, 2, 3), NOW).remaining).toBe(
      EXPORTS_PER_WINDOW - 4,
    );
  });

  it("refuses once the window is full", () => {
    const full = agesAgo(
      ...Array.from({ length: EXPORTS_PER_WINDOW }, (_, i) => i + 1),
    );
    const decision = decideExportRate(full, NOW);
    expect(decision.allowed).toBe(false);
    expect(decision.remaining).toBe(0);
  });

  it("ignores exports that have fallen out of the window", () => {
    const stale = agesAgo(
      ...Array.from({ length: EXPORTS_PER_WINDOW }, () => 61),
    );
    expect(decideExportRate(stale, NOW).allowed).toBe(true);
  });

  it("says when the window reopens, not a flat hour", () => {
    // Oldest is 59 minutes old, so one more slot opens in a minute.
    const times = agesAgo(
      59,
      ...Array.from({ length: EXPORTS_PER_WINDOW - 1 }, () => 1),
    );
    const decision = decideExportRate(times, NOW);
    expect(decision.allowed).toBe(false);
    expect(decision.retryAfterSeconds).toBeLessThanOrEqual(60);
    expect(decision.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("never returns a zero Retry-After while refusing", () => {
    const times = agesAgo(
      ...Array.from(
        { length: EXPORTS_PER_WINDOW },
        () => EXPORT_WINDOW_MS / 60_000 - 0.001,
      ),
    );
    const decision = decideExportRate(times, NOW);
    expect(decision.allowed).toBe(false);
    expect(decision.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });
});
