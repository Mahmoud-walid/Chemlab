import { and, eq } from "drizzle-orm";
import { uuidv7 } from "uuidv7";

import { getDb } from "@/db/client";
import { pushSubscriptions } from "@/db/schema/push";
import { requireUserOr401 } from "@/lib/session";
import {
  subscriptionSchema,
  unsubscribeSchema,
} from "@/lib/push/subscription-schema";

/**
 * A device's push subscription.
 *
 * `POST` to register or refresh one, `DELETE` to remove it. Both require a
 * session: an anonymous subscription is a row nobody could ever send to, and
 * accepting one would let anybody fill the table.
 *
 * The endpoint is the identity. Re-subscribing the same browser UPDATES rather
 * than inserts — without that, a user who reloads the settings page ten times
 * has ten rows and receives ten copies of every notification.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const { user, response } = await requireUserOr401();
  if (response) return response;

  const parsed = subscriptionSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return Response.json({ error: "invalid subscription" }, { status: 400 });
  }

  const { endpoint, keys } = parsed.data;

  await getDb()
    .insert(pushSubscriptions)
    .values({
      id: uuidv7(),
      userId: user.id,
      endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
      // Stored so the settings screen can say which device a row is, and
      // truncated because a user agent string is attacker-controlled text of
      // unbounded length.
      userAgent: request.headers.get("user-agent")?.slice(0, 300) ?? null,
    })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: {
        // The USER too: a shared device signed into a second account must not
        // keep pushing the first account's notifications.
        userId: user.id,
        p256dh: keys.p256dh,
        auth: keys.auth,
        failureCount: 0,
      },
    });

  return Response.json({ ok: true }, { status: 201 });
}

export async function DELETE(request: Request) {
  const { user, response } = await requireUserOr401();
  if (response) return response;

  const parsed = unsubscribeSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return Response.json({ error: "invalid endpoint" }, { status: 400 });
  }

  // Scoped to the caller's own rows. Without the user clause this endpoint
  // would delete anybody's subscription for anybody who learned its endpoint.
  await getDb()
    .delete(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.endpoint, parsed.data.endpoint),
        eq(pushSubscriptions.userId, user.id),
      ),
    );

  return new Response(null, { status: 204 });
}
