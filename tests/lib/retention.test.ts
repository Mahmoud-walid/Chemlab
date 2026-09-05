import { describe, expect, it } from "vitest";

import {
  EVENT_RETENTION_DAYS,
  PII_RETENTION_DAYS,
  retentionCutoffs,
  retentionWindowsAreCoherent,
} from "@/lib/exports/retention";

const NOW = new Date("2026-09-05T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

describe("retentionCutoffs", () => {
  it("puts the delete cutoff at the event window", () => {
    const { deleteBefore } = retentionCutoffs(NOW);
    expect(NOW.getTime() - deleteBefore.getTime()).toBe(
      EVENT_RETENTION_DAYS * DAY,
    );
  });

  it("puts the anonymise cutoff nearer, at the shorter PII window", () => {
    const { anonymiseBefore, deleteBefore } = retentionCutoffs(NOW);
    expect(NOW.getTime() - anonymiseBefore.getTime()).toBe(
      PII_RETENTION_DAYS * DAY,
    );
    expect(anonymiseBefore.getTime()).toBeGreaterThan(deleteBefore.getTime());
  });

  it("takes overrides, so a test can stand anywhere", () => {
    const { deleteBefore } = retentionCutoffs(NOW, { events: 1 });
    expect(deleteBefore).toEqual(new Date(NOW.getTime() - DAY));
  });
});

describe("retentionWindowsAreCoherent", () => {
  it("accepts the shipped windows", () => {
    expect(
      retentionWindowsAreCoherent(EVENT_RETENTION_DAYS, PII_RETENTION_DAYS),
    ).toBe(true);
  });

  it("rejects keeping personal data longer than the events themselves", () => {
    // The failure this guards: the anonymise pass would have nothing to touch,
    // because everything old enough would already be deleted — a shorter PII
    // window that looks enforced and does nothing.
    expect(retentionWindowsAreCoherent(90, 180)).toBe(false);
  });

  it("rejects a zero window, which would mean keeping nothing at all", () => {
    expect(retentionWindowsAreCoherent(180, 0)).toBe(false);
    expect(retentionWindowsAreCoherent(0, 0)).toBe(false);
  });
});
