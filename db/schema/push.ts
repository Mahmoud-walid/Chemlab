import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { id } from "./_shared";
import { users } from "./auth";
import type { NotificationPayload } from "@/lib/push/payload";

/**
 * Web Push: who we can reach, and what is waiting to be sent.
 *
 * Self-hosted over VAPID — no vendor, no per-message cost, and the whole queue
 * is inspectable with SQL, which is what matters when somebody says "I never
 * got it".
 */

export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: id(),
    // `text`, matching `users.id` — Better Auth owns that column's type.
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    /**
     * The push service's URL for this device. Long, opaque, and issued by the
     * browser vendor — it is the address, and it is also the identity: two
     * endpoints are two devices, the same endpoint twice is one device
     * subscribing again.
     */
    endpoint: text("endpoint").notNull(),
    /** The device's public key and auth secret, for payload encryption. */
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),

    /** For the settings screen: "Chrome on Android", so somebody can tell
     * which of their four rows is the phone they want to unsubscribe. */
    userAgent: text("user_agent"),
    /** "web" today. Leaves room for a native channel without a migration. */
    platform: text("platform").notNull().default("web"),

    /**
     * Consecutive non-fatal failures. A 404 or 410 deletes the row outright —
     * the subscription is gone and the push service is telling us so — but a
     * run of 500s or timeouts means a device that may come back, so it is
     * counted rather than acted on immediately.
     */
    failureCount: integer("failure_count").notNull().default(0),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  },
  (t) => [
    /**
     * One row per device, enforced. Re-subscribing the same browser must
     * update rather than insert: without this a user who reloads the settings
     * page ten times has ten rows and gets ten copies of every notification.
     */
    uniqueIndex("push_subscriptions_endpoint_idx").on(t.endpoint),
    index("push_subscriptions_user_idx").on(t.userId),
  ],
);

export const deliveryStatus = pgEnum("push_delivery_status", [
  "pending",
  "sent",
  "failed",
  /** The subscription was gone. Kept as a distinct outcome from `failed`
   * because it is not an error to investigate — it is a device that has
   * unsubscribed, and the row explains why nothing arrived. */
  "expired",
]);

/**
 * The queue.
 *
 * A request that triggers five hundred notifications writes five hundred rows
 * and returns. Without this it would block on five hundred HTTPS calls to
 * push services, and a serverless function would be killed part-way through —
 * leaving some sent, some not, and no record of which.
 *
 * Drained by `pnpm push:drain`, claiming a batch with `for update skip locked`
 * so two drains running at once cannot send the same row twice.
 */
export const pushDeliveries = pgTable(
  "push_deliveries",
  {
    id: id(),
    subscriptionId: uuid("subscription_id")
      .notNull()
      .references(() => pushSubscriptions.id, { onDelete: "cascade" }),

    payload: jsonb("payload").$type<NotificationPayload>().notNull(),
    status: deliveryStatus("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),

    /**
     * When this may be sent. Retries push it into the future with exponential
     * backoff, and #21's quiet hours defer a push to the end of the window by
     * setting it — which is why a deferred notification is a row with a
     * timestamp rather than something dropped and hoped for.
     */
    scheduledFor: timestamp("scheduled_for", { withTimezone: true })
      .notNull()
      .defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // The drain's only query: pending rows that are due, oldest first.
    index("push_deliveries_drain_idx").on(t.status, t.scheduledFor),
  ],
);

export type PushSubscriptionRow = typeof pushSubscriptions.$inferSelect;
export type PushDelivery = typeof pushDeliveries.$inferSelect;
