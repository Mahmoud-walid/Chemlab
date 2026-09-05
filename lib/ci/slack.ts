import "server-only";

import type { SlackMessage } from "./render";

/**
 * Posting to a Slack incoming webhook.
 *
 * Separated from the rendering so the message can be tested without a network
 * call and this can be tested without a message. `server-only`: the webhook
 * URL is the credential, and importing this from a client component would be
 * a build error rather than a leak found later.
 */

export type SlackResult = "sent" | "skipped" | "failed";

/**
 * Sends, and never throws.
 *
 * A CI alert that fails to reach Slack must still reach the phone, and an
 * exception here would abort the response the workflow is waiting on. Slack
 * being down is not a reason for CI to look broken.
 */
export async function postToSlack(
  webhookUrl: string | undefined,
  message: SlackMessage,
): Promise<SlackResult> {
  // Not configured is not a failure: the Web Push half ships without it, and
  // this issue's Slack half is blocked on the owner's webhook.
  if (!webhookUrl) return "skipped";

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(message),
      // Slack answers in milliseconds when it answers at all. A hung request
      // would hold the workflow's step open to its own timeout.
      signal: AbortSignal.timeout(5_000),
    });

    return response.ok ? "sent" : "failed";
  } catch {
    // Deliberately swallowed and reported as a value. The caller records it in
    // the response body, so a CI log shows `slack: "failed"` rather than a
    // stack trace nobody reads.
    return "failed";
  }
}
