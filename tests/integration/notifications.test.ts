import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { uuidv7 } from "uuidv7";

import { connect, seedUrl, type SeedDatabase } from "@/db/seed/connect";
import * as schema from "@/db/schema";
import {
  claimEvents,
  listNotifications,
  markRead,
  preferencesFor,
  recordNotification,
  savePreferences,
  unreadCount,
} from "@/db/queries/notifications";
import { emitNotificationEvent } from "@/lib/notifications/emit";
import { fanOut } from "@/lib/notifications/fanout";
import { DEFAULT_PREFERENCES, decidePush } from "@/lib/notifications/rules";
import { toUpdate } from "@/lib/notifications/preferences-input";

/**
 * Notifications, against real Postgres.
 *
 * The claims that need a database rather than a mock: the aggregation is a
 * partial unique index on UNREAD rows, so it is the database that decides
 * whether five likes are one notification; the outbox is transactional, so a
 * rolled-back like must leave no event; and the preference defaults have to
 * hold for a user who has no preference row at all.
 */

let db: SeedDatabase;
let close: () => Promise<void>;

const AUTHOR = `notif-author-${uuidv7()}`;
const LIKER_A = `notif-a-${uuidv7()}`;
const LIKER_B = `notif-b-${uuidv7()}`;
const USERS = [AUTHOR, LIKER_A, LIKER_B];

const SUBJECT = `comment-${uuidv7()}`;

beforeAll(async () => {
  const url = seedUrl();
  if (!url) throw new Error("no database URL");
  ({ db, close } = connect(url));

  for (const id of USERS) {
    await db.insert(schema.users).values({
      id,
      name: `Notif ${id.slice(-4)}`,
      email: `${id}@notif.invalid`,
      emailVerified: true,
    });
  }
});

afterEach(async () => {
  await db
    .delete(schema.notifications)
    .where(inArray(schema.notifications.recipientId, USERS));
  await db
    .delete(schema.notificationOutbox)
    .where(eq(schema.notificationOutbox.subjectId, SUBJECT));
  await db
    .delete(schema.notificationPreferences)
    .where(inArray(schema.notificationPreferences.userId, USERS));
});

afterAll(async () => {
  await db.delete(schema.users).where(inArray(schema.users.id, USERS));
  await close?.();
});

async function like(actorId: string) {
  return recordNotification(db, {
    recipientId: AUTHOR,
    type: "comment.liked",
    actorId,
    subjectType: "comment",
    subjectId: SUBJECT,
  });
}

describe("aggregation", () => {
  it("folds several likers into one unread row", async () => {
    // #21's criterion: five people liking one comment is ONE notification
    // saying so, not five.
    await like(LIKER_A);
    await like(LIKER_B);

    const [row] = await db
      .select({
        actorCount: schema.notifications.actorCount,
        actorIds: schema.notifications.actorIds,
      })
      .from(schema.notifications)
      .where(eq(schema.notifications.recipientId, AUTHOR));

    expect(await unreadCount(db, AUTHOR)).toBe(1);
    expect(row!.actorCount).toBe(2);
    expect(row!.actorIds).toContain(LIKER_A);
  });

  it("counts one person liking twice as one person", async () => {
    await like(LIKER_A);
    await like(LIKER_A);

    const [row] = await db
      .select({ actorCount: schema.notifications.actorCount })
      .from(schema.notifications)
      .where(eq(schema.notifications.recipientId, AUTHOR));

    expect(row!.actorCount).toBe(1);
  });

  it("starts a fresh row once the last one has been read", async () => {
    // Somebody who has not looked at the bell should see one line; somebody
    // who read it and then got a new like deserves a new notification.
    await like(LIKER_A);
    await markRead(db, AUTHOR, "all");
    await like(LIKER_B);

    expect(await unreadCount(db, AUTHOR)).toBe(1);
    const all = await listNotifications(db, AUTHOR);
    expect(all.rows).toHaveLength(2);
  });

  it("does not aggregate a reply", async () => {
    // Two replies are two things to read; collapsing them hides one behind a
    // count. The aggregation index excludes this type for exactly that reason
    // — applied to it, the database would reject the second reply.
    for (const actor of [LIKER_A, LIKER_B]) {
      await recordNotification(db, {
        recipientId: AUTHOR,
        type: "comment.replied",
        actorId: actor,
        subjectType: "comment",
        subjectId: SUBJECT,
      });
    }
    expect(await unreadCount(db, AUTHOR)).toBe(2);
  });
});

describe("suppression", () => {
  it("writes nothing when you act on your own work", async () => {
    const result = await like(AUTHOR);
    expect(result.recorded).toBe(false);
    expect(await unreadCount(db, AUTHOR)).toBe(0);
  });
});

describe("preferences", () => {
  it("treats a user with no row as having the defaults", async () => {
    // Not as opted out — a user who never visited the settings page must not
    // silently receive nothing.
    expect(await preferencesFor(db, AUTHOR)).toEqual(DEFAULT_PREFERENCES);
  });

  it("reads a stored row", async () => {
    await db.insert(schema.notificationPreferences).values({
      userId: AUTHOR,
      categories: { "comment.liked": false },
      pushEnabled: false,
      timezone: "Africa/Cairo",
    });

    const preferences = await preferencesFor(db, AUTHOR);
    expect(preferences.categories["comment.liked"]).toBe(false);
    expect(preferences.pushEnabled).toBe(false);
    expect(preferences.timezone).toBe("Africa/Cairo");
  });
});

describe("the outbox", () => {
  it("leaves no event when its transaction rolls back", async () => {
    // The property that matters most, and the one direct calls cannot offer:
    // no phantom notification about a like that no longer exists.
    await expect(
      db.transaction(async (tx) => {
        await emitNotificationEvent(tx, {
          type: "comment.liked",
          actorId: LIKER_A,
          subjectType: "comment",
          subjectId: SUBJECT,
          recipientId: AUTHOR,
        });
        throw new Error("the domain change failed");
      }),
    ).rejects.toThrow();

    expect(await claimEvents(db)).toHaveLength(0);
  });

  it("keeps the event when its transaction commits", async () => {
    await db.transaction(async (tx) => {
      await emitNotificationEvent(tx, {
        type: "comment.liked",
        actorId: LIKER_A,
        subjectType: "comment",
        subjectId: SUBJECT,
        recipientId: AUTHOR,
      });
    });

    const events = await claimEvents(db);
    expect(events.map((event) => event.subjectId)).toContain(SUBJECT);
  });
});

describe("fan-out", () => {
  it("turns an event into a notification for the named recipient", async () => {
    await db.transaction(async (tx) => {
      await emitNotificationEvent(tx, {
        type: "comment.liked",
        actorId: LIKER_A,
        subjectType: "comment",
        subjectId: SUBJECT,
        recipientId: AUTHOR,
        data: { lessonSlug: "acids-and-bases", commentId: SUBJECT },
      });
    });

    const result = await fanOut(db);

    expect(result.notifications).toBeGreaterThanOrEqual(1);
    expect(await unreadCount(db, AUTHOR)).toBe(1);
  });

  it("writes the row even when the category is muted", async () => {
    // Muting stops DELIVERY, never the record. The bell is the source of
    // truth, and a user who muted the buzz still needs to find out.
    await db.insert(schema.notificationPreferences).values({
      userId: AUTHOR,
      categories: { "comment.liked": false },
    });

    await db.transaction(async (tx) => {
      await emitNotificationEvent(tx, {
        type: "comment.liked",
        actorId: LIKER_A,
        subjectType: "comment",
        subjectId: SUBJECT,
        recipientId: AUTHOR,
      });
    });

    await fanOut(db);
    expect(await unreadCount(db, AUTHOR)).toBe(1);
  });

  it("records nothing for a self-action that reached the outbox", async () => {
    await db.transaction(async (tx) => {
      await emitNotificationEvent(tx, {
        type: "comment.liked",
        actorId: AUTHOR,
        subjectType: "comment",
        subjectId: SUBJECT,
        recipientId: AUTHOR,
      });
    });

    const result = await fanOut(db);
    expect(result.suppressed).toBe(1);
    expect(await unreadCount(db, AUTHOR)).toBe(0);
  });

  it("processes each event once", async () => {
    await db.transaction(async (tx) => {
      await emitNotificationEvent(tx, {
        type: "comment.liked",
        actorId: LIKER_A,
        subjectType: "comment",
        subjectId: SUBJECT,
        recipientId: AUTHOR,
      });
    });

    await fanOut(db);
    const second = await fanOut(db);

    // Claimed events are marked processed, so a second run finds nothing —
    // otherwise every run would re-notify everybody about everything.
    expect(second.events).toBe(0);
  });
});

describe("the inbox", () => {
  it("returns only the caller's own notifications", async () => {
    await like(LIKER_A);
    await recordNotification(db, {
      recipientId: LIKER_B,
      type: "comment.liked",
      actorId: AUTHOR,
      subjectType: "comment",
      subjectId: SUBJECT,
    });

    const mine = await listNotifications(db, AUTHOR);
    expect(mine.rows).toHaveLength(1);
    expect(mine.rows.every((row) => row.subjectId === SUBJECT)).toBe(true);
  });

  it("marks one read without touching the rest", async () => {
    await like(LIKER_A);
    await recordNotification(db, {
      recipientId: AUTHOR,
      type: "comment.replied",
      actorId: LIKER_B,
      subjectType: "comment",
      subjectId: `${SUBJECT}-other`,
    });

    const page = await listNotifications(db, AUTHOR);
    await markRead(db, AUTHOR, [page.rows[0]!.id]);

    expect(await unreadCount(db, AUTHOR)).toBe(1);
  });

  it("cannot mark somebody else's notification read", async () => {
    // Scoped to the caller's own rows: there is no user id parameter to get
    // wrong, and passing another person's id changes nothing.
    await recordNotification(db, {
      recipientId: LIKER_B,
      type: "comment.liked",
      actorId: AUTHOR,
      subjectType: "comment",
      subjectId: SUBJECT,
    });

    const theirs = await listNotifications(db, LIKER_B);
    const changed = await markRead(db, AUTHOR, [theirs.rows[0]!.id]);

    expect(changed).toBe(0);
    expect(await unreadCount(db, LIKER_B)).toBe(1);
  });

  it("pages without repeating or skipping", async () => {
    for (let i = 0; i < 5; i++) {
      await recordNotification(db, {
        recipientId: AUTHOR,
        type: "comment.replied",
        actorId: LIKER_A,
        subjectType: "comment",
        subjectId: `${SUBJECT}-${i}`,
      });
    }

    const first = await listNotifications(db, AUTHOR, { limit: 2 });
    const second = await listNotifications(db, AUTHOR, {
      limit: 2,
      before: first.nextCursor!,
    });

    expect(first.rows).toHaveLength(2);
    expect(second.rows).toHaveLength(2);
    const ids = [...first.rows, ...second.rows].map((row) => row.id);
    expect(new Set(ids).size).toBe(4);
  });

  it("stores no user-facing English", async () => {
    // #21's criterion, asserted over the row shape: the sentence is composed
    // at render time from the RECIPIENT's locale, so a stored string would be
    // English for ever and would make Arabic's plural forms impossible.
    await like(LIKER_A);

    const [row] = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.recipientId, AUTHOR));

    // `type` is excluded on purpose: `comment.liked` is a machine identifier,
    // not a sentence, and it is the enum the database itself stores. What must
    // not appear is prose — anywhere a message could have been baked in.
    const { type: _type, ...rest } = row!;
    const serialised = JSON.stringify(rest).toLowerCase();

    for (const phrase of [
      "liked your",
      "replied to",
      "people liked",
      "has been published",
    ]) {
      expect(serialised, phrase).not.toContain(phrase);
    }
  });
});

describe("saving preferences", () => {
  it("creates the row on first change, rather than needing one", async () => {
    // Most people have none: preferences are DEFAULTS until somebody changes
    // something, so a missing row is a normal state and not one the settings
    // page should have to create first.
    const before = await preferencesFor(db, LIKER_A);
    expect(before).toEqual(DEFAULT_PREFERENCES);

    const saved = await savePreferences(
      db,
      LIKER_A,
      toUpdate({ categories: { "comment.liked": false } }, before),
    );

    expect(saved.categories).toEqual({ "comment.liked": false });
    // Untouched by a patch that never mentioned them.
    expect(saved.pushEnabled).toBe(true);
    expect(saved.timezone).toBe("UTC");
  });

  it("leaves alone what the patch did not carry", async () => {
    // The property the whole patch shape exists for: two tabs open on the
    // settings page, and the later save must not undo the earlier one.
    const first = await preferencesFor(db, LIKER_B);
    await savePreferences(
      db,
      LIKER_B,
      toUpdate(
        { categories: { "comment.liked": false }, timezone: "Africa/Cairo" },
        first,
      ),
    );

    const second = await preferencesFor(db, LIKER_B);
    const after = await savePreferences(
      db,
      LIKER_B,
      toUpdate({ categories: { "lesson.published": false } }, second),
    );

    expect(after.categories).toEqual({
      "comment.liked": false,
      "lesson.published": false,
    });
    expect(after.timezone).toBe("Africa/Cairo");
  });

  it("stops the push and keeps the record", async () => {
    // The distinction that runs through the whole feature: muting stops
    // DELIVERY, never the record. Somebody who muted the category still needs
    // to be able to find out that it happened.
    const current = await preferencesFor(db, AUTHOR);
    const muted = await savePreferences(
      db,
      AUTHOR,
      toUpdate({ categories: { "comment.liked": false } }, current),
    );

    expect(decidePush("comment.liked", muted, new Date()).send).toBe(false);

    const result = await recordNotification(db, {
      recipientId: AUTHOR,
      type: "comment.liked",
      subjectType: "comment",
      subjectId: SUBJECT,
      actorId: LIKER_A,
      data: {},
    });

    expect(result.recorded).toBe(true);
    expect(await unreadCount(db, AUTHOR)).toBeGreaterThan(0);
  });
});
