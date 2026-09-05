import { uuidv7 } from "uuidv7";

import { notificationOutbox } from "@/db/schema/notifications";
import type { NotificationData, NotificationType } from "./types";

/**
 * The one function feature code calls.
 *
 * `emitNotificationEvent(tx, event)` — and that is the whole surface. The like
 * handler knows nothing about push, preferences, locales or aggregation, and
 * adding a channel later (email, Slack) touches the fan-out worker only.
 *
 * It takes the TRANSACTION, not a database handle, and that is the point: the
 * event is written in the same transaction as the domain change, so a
 * rolled-back like leaves no event behind. Direct calls cannot offer that — a
 * `await notify(...)` inside a handler can have sent a push about a like that
 * was then rolled away, and there is no unsending it.
 */

export interface NotificationEvent {
  type: NotificationType;
  /** Null for a system event. Never taken from the request. */
  actorId: string | null;
  subjectType: string;
  subjectId: string;
  /**
   * For a personal event, who receives it. The emitter knows — the lesson's
   * author, the comment's author — and re-deriving it in the worker would mean
   * the worker knowing every feature's ownership rules.
   */
  recipientId?: string | null;
  data?: NotificationData;
}

/** Anything with an `insert`, so this works with a transaction or a handle. */
export interface Inserter {
  insert: (table: typeof notificationOutbox) => {
    values: (row: Record<string, unknown>) => Promise<unknown>;
  };
}

export async function emitNotificationEvent(
  tx: Inserter,
  event: NotificationEvent,
): Promise<void> {
  await tx.insert(notificationOutbox).values({
    id: uuidv7(),
    type: event.type,
    actorId: event.actorId,
    subjectType: event.subjectType,
    subjectId: event.subjectId,
    payload: {
      recipientId: event.recipientId ?? null,
      data: event.data ?? {},
    },
  });
}
