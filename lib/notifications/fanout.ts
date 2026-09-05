import type { AnyDatabase } from "@/db/any-database";
import {
  broadcastRecipients,
  claimEvents,
  markEventFailed,
  markProcessed,
  preferencesFor,
  recordNotification,
  type PendingEvent,
} from "@/db/queries/notifications";
import { enqueueForUsers } from "@/lib/push/queue";
import { parsePayload } from "@/lib/push/payload";
import { decidePush, pushTag } from "./rules";
import { specFor, type NotificationType } from "./types";

/**
 * Outbox events → notification rows → queued pushes.
 *
 * The only place that knows about all three. Feature code emits an event and
 * knows nothing about preferences, aggregation, locales or push; adding a
 * channel later touches this file and nothing else.
 *
 * Order matters: the ROW is written first, unconditionally, and the push is
 * queued after and only if the preferences allow it. Muting stops delivery,
 * never the record — a user who muted a category still needs the bell to tell
 * them what happened.
 */

export interface FanoutResult {
  events: number;
  notifications: number;
  suppressed: number;
  pushesQueued: number;
  failed: number;
}

/**
 * The push text.
 *
 * Deliberately generic and non-specific for now: composing the recipient's
 * sentence needs their locale and next-intl's server catalogue, which is the
 * bell's job at render time. A push that said the wrong thing in the wrong
 * language would be worse than one that says "you have something new" — and
 * this is the one place a stored user-facing string could sneak in, so it
 * stays out.
 */
function pushTextFor(type: NotificationType): { title: string; body: string } {
  return {
    title: "Chemlab",
    body:
      specFor(type).targeting === "broadcast"
        ? "Something new has been published."
        : "Somebody interacted with your work.",
  };
}

function urlFor(event: PendingEvent): string {
  const data = (event.payload.data ?? {}) as Record<string, unknown>;
  const lessonSlug =
    typeof data.lessonSlug === "string" ? data.lessonSlug : null;
  const quizSlug = typeof data.quizSlug === "string" ? data.quizSlug : null;
  const commentId = typeof data.commentId === "string" ? data.commentId : null;

  if (lessonSlug) {
    return commentId
      ? `/lessons/${lessonSlug}#comment-${commentId}`
      : `/lessons/${lessonSlug}`;
  }
  if (quizSlug) return `/quiz/${quizSlug}`;
  return "/notifications";
}

export async function fanOut(
  db: AnyDatabase,
  options: { now?: Date; limit?: number } = {},
): Promise<FanoutResult> {
  const now = options.now ?? new Date();
  const events = await claimEvents(db, options.limit);

  const result: FanoutResult = {
    events: events.length,
    notifications: 0,
    suppressed: 0,
    pushesQueued: 0,
    failed: 0,
  };

  for (const event of events) {
    try {
      const recipients = await recipientsFor(db, event);

      for (const recipientId of recipients) {
        const written = await recordNotification(db, {
          recipientId,
          type: event.type,
          actorId: event.actorId,
          subjectType: event.subjectType,
          subjectId: event.subjectId,
          data: (event.payload.data ?? {}) as Record<string, unknown>,
        });

        if (!written.recorded) {
          // A self-action, almost always. Not a failure.
          result.suppressed += 1;
          continue;
        }
        result.notifications += 1;

        const decision = decidePush(
          event.type,
          await preferencesFor(db, recipientId),
          now,
        );
        if (!decision.send && !decision.deferUntil) continue;

        const text = pushTextFor(event.type);
        const queued = await enqueueForUsers(
          db,
          [recipientId],
          parsePayload({
            ...text,
            url: urlFor(event),
            // The same key the row aggregates on, so an updated count REPLACES
            // the tray entry instead of stacking beside it.
            tag: pushTag(event.type, event.subjectId),
          }),
          // Quiet hours defer rather than drop: the notification arrives when
          // the window ends, which is the thing the user asked for.
          decision.deferUntil ?? now,
        );
        result.pushesQueued += queued.queued;
      }

      await markProcessed(db, event.id);
    } catch (error) {
      // One bad event must not stop the batch. Left unprocessed with the
      // reason recorded, so it is retried and visible rather than lost.
      result.failed += 1;
      await markEventFailed(db, event.id, String(error));
    }
  }

  return result;
}

/** Who this event is for. */
async function recipientsFor(
  db: AnyDatabase,
  event: PendingEvent,
): Promise<string[]> {
  if (specFor(event.type).targeting === "personal") {
    const recipientId = event.payload.recipientId;
    // A personal event with no recipient is a bug in the emitter, not
    // something to guess at: notifying the wrong person is worse than
    // notifying nobody.
    return typeof recipientId === "string" ? [recipientId] : [];
  }

  return broadcastRecipients(db, event.actorId);
}
