import { describe, expect, it } from "vitest";

import {
  badgeLabel,
  groupByDay,
  hrefFor,
  toView,
  type NotificationRow,
} from "@/lib/notifications/render";

/**
 * Turning a stored row into something a person can read.
 *
 * All pure, and worth testing directly, because two of these decisions are
 * ones a UI test would only catch by accident: where a notification points
 * when its subject is gone, and which day heading a row falls under across a
 * midnight boundary.
 */

function row(overrides: Partial<NotificationRow> = {}): NotificationRow {
  return {
    type: "lesson.liked",
    subjectType: "lesson",
    subjectId: "lesson-1",
    actorCount: 1,
    actorName: "Sara",
    data: { lessonSlug: "acids-and-bases" },
    ...overrides,
  };
}

describe("where a notification points", () => {
  it("links to the lesson", () => {
    expect(hrefFor(row())).toBe("/lessons/acids-and-bases");
  });

  it("anchors to the comment when there is one", () => {
    // Landing at the top of a long lesson and hunting for the reply is the
    // difference between a notification that works and one that is a chore.
    expect(
      hrefFor(
        row({ data: { lessonSlug: "acids-and-bases", commentId: "c7" } }),
      ),
    ).toBe("/lessons/acids-and-bases#comment-c7");
  });

  it("links to the quiz when that is the subject", () => {
    expect(hrefFor(row({ data: { quizSlug: "halogens" } }))).toBe(
      "/quiz/halogens",
    );
  });

  it("returns null when the subject is gone", () => {
    // The UI renders a tombstone from this. A notification that 404s the
    // person who clicked it is worse than one that says the thing is gone.
    expect(hrefFor(row({ data: {} }))).toBeNull();
    expect(toView(row({ data: {} }), "Someone")).toBeNull();
  });

  it("ignores a slug that is not a usable string", () => {
    // Data is JSON from a column: a number or an empty string is a broken
    // link, not a link.
    expect(hrefFor(row({ data: { lessonSlug: "" } }))).toBeNull();
    expect(hrefFor(row({ data: { lessonSlug: 42 } }))).toBeNull();
    expect(hrefFor(row({ data: { lessonSlug: null } }))).toBeNull();
  });
});

describe("the values a message is rendered with", () => {
  it("falls back to a placeholder when the actor is gone", () => {
    // `actor_id` is `set null` on delete, so this is the normal state after
    // somebody deletes their account — not an edge case.
    const view = toView(row({ actorName: null }), "Someone");
    expect(view!.values.actor).toBe("Someone");
  });

  it("never counts below one", () => {
    // A row exists because somebody did something. "0 people liked your
    // lesson" is a sentence no plural rule should have to render.
    expect(toView(row({ actorCount: 0 }), "Someone")!.values.count).toBe(1);
    expect(toView(row({ actorCount: 5 }), "Someone")!.values.count).toBe(5);
  });

  it("carries the type through as the message key", () => {
    expect(toView(row({ type: "comment.replied" }), "Someone")!.key).toBe(
      "comment.replied",
    );
  });
});

describe("grouping by day", () => {
  const now = new Date("2026-03-10T09:00:00Z");
  const at = (iso: string) => ({ createdAt: new Date(iso) });

  it("splits today, yesterday and earlier, in that order", () => {
    const groups = groupByDay(
      [
        at("2026-03-01T12:00:00Z"),
        at("2026-03-10T08:00:00Z"),
        at("2026-03-09T23:00:00Z"),
      ],
      now,
    );

    expect(groups.map((group) => group.day)).toEqual([
      "today",
      "yesterday",
      "earlier",
    ]);
  });

  it("omits a day with nothing in it", () => {
    // An empty "Yesterday" heading is a heading over nothing.
    const groups = groupByDay([at("2026-03-10T08:00:00Z")], now);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.day).toBe("today");
  });

  it("buckets by calendar day, not by elapsed hours", () => {
    // Two hours ago at 00:30 is YESTERDAY at 22:30, and a reader who has just
    // woken up does not think of it as today. Comparing timestamps rather than
    // days gets this wrong for everybody who reads notifications in the
    // morning.
    const justAfterMidnight = new Date("2026-03-10T00:30:00");
    const lateLastNight = new Date("2026-03-09T22:30:00");

    const groups = groupByDay(
      [{ createdAt: lateLastNight }],
      justAfterMidnight,
    );
    expect(groups[0]!.day).toBe("yesterday");
  });

  it("keeps a row from the future in today rather than dropping it", () => {
    // Clock skew between the database and the browser is real, and a
    // notification that lands in no group at all disappears from the list.
    const groups = groupByDay([at("2026-03-10T23:00:00Z")], now);
    expect(groups[0]!.day).toBe("today");
  });

  it("returns nothing for an empty inbox", () => {
    expect(groupByDay([], now)).toEqual([]);
  });
});

describe("the bell's badge", () => {
  it("shows nothing at zero", () => {
    // A badge saying "0" is a badge that says there is something.
    expect(badgeLabel(0)).toBe("");
    expect(badgeLabel(-1)).toBe("");
  });

  it("caps at nine, so a long absence cannot widen the bell", () => {
    expect(badgeLabel(9)).toBe("9");
    expect(badgeLabel(10)).toBe("9+");
    expect(badgeLabel(4_000)).toBe("9+");
  });
});
