import { createHash } from "node:crypto";

import {
  commitSubject,
  shortSha,
  type CiNotifyPayload,
  type CiOutcome,
} from "./payload";
import {
  BODY_MAX,
  TITLE_MAX,
  type NotificationPayload,
} from "@/lib/push/payload";

/**
 * One run, two renderings.
 *
 * The push notification and the Slack message are built from the SAME payload,
 * here, rather than each being assembled where it is sent. Two senders
 * describing the same run in their own words drift — and the one that drifts
 * is always the one nobody is watching, which for a CI alert is the one that
 * matters.
 *
 * Pure. No network, no database: `tests/lib/ci-render.test.ts` renders every
 * outcome without either.
 */

const MARK: Record<CiOutcome, string> = {
  success: "✅",
  failure: "❌",
  cancelled: "⚪",
};

/** What the run is called in a sentence. `recovery` is a success, but saying
 * "CI passed" for the first green after a red buries the news. */
function headline(payload: CiNotifyPayload, recovery: boolean): string {
  const { outcome, job, branch } = payload;

  if (outcome === "success") {
    return recovery
      ? `${MARK.success} ${branch} is back to green`
      : `${MARK.success} ${job} passed on ${branch}`;
  }
  if (outcome === "cancelled") {
    return `${MARK.cancelled} ${job} was cancelled on ${branch}`;
  }
  return `${MARK.failure} ${job} failed on ${branch}`;
}

/** Trimmed with an ellipsis rather than cut mid-word by the OS, which shows
 * the truncation as though the message simply stopped. */
function clamp(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

export function toPushPayload(
  payload: CiNotifyPayload,
  recovery: boolean,
): NotificationPayload {
  const subject = commitSubject(payload.commitMessage);
  const failed =
    payload.outcome === "failure" && payload.failedJobs.length > 0
      ? `${payload.failedJobs.join(", ")} · `
      : "";

  return {
    title: clamp(headline(payload, recovery), TITLE_MAX),
    body: clamp(
      `${failed}${shortSha(payload.commitSha)} ${subject} — ${payload.actor}`,
      BODY_MAX,
    ),
    icon: "/icons/icon-192.png",
    badge: "/icons/badge-72.png",
    // The run, not the repository: somebody woken by a failure wants the log.
    url: payload.runUrl,
    /**
     * One notification per (branch, job). A tray holding six failures from six
     * pushes to the same branch is six taps to reach the one that matters, and
     * the fifth is stale by the time it is read.
     */
    tag: runTag(payload),
    // A new failure on a branch already failing IS worth a second buzz: it is
    // a different commit, and silently replacing the tray entry would look
    // like nothing happened.
    renotify: true,
    data: {
      runUrl: payload.runUrl,
      outcome: payload.outcome,
      branch: payload.branch,
      job: payload.job,
    },
  };
}

/**
 * Slack Block Kit, not a `text` blob.
 *
 * `text` is still set: it is what Slack shows in the notification, in the
 * sidebar and to a screen reader, and a message with blocks and no fallback
 * reads as "This content can't be displayed" in exactly those places.
 */
export interface SlackMessage {
  text: string;
  blocks: unknown[];
}

export function toSlackMessage(
  payload: CiNotifyPayload,
  recovery: boolean,
  repositoryUrl = `https://github.com/${payload.repository}`,
): SlackMessage {
  const subject = commitSubject(payload.commitMessage);
  const text = headline(payload, recovery);

  const context = [
    `\`${payload.branch}\``,
    `<${repositoryUrl}/commit/${payload.commitSha}|${shortSha(payload.commitSha)}>`,
    payload.actor,
    payload.durationSeconds !== undefined
      ? formatDuration(payload.durationSeconds)
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const blocks: unknown[] = [
    {
      type: "header",
      // Slack refuses emoji-only plain_text over 150 chars and renders no
      // markdown in a header, so the headline goes in as-is.
      text: { type: "plain_text", text: clamp(text, 150), emoji: true },
    },
    {
      type: "context",
      elements: [{ type: "mrkdwn", text: context }],
    },
  ];

  if (subject) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: clamp(subject, 300) },
    });
  }

  if (payload.outcome === "failure" && payload.failedJobs.length > 0) {
    const jobs = payload.failedJobs.map((job) => `\`${job}\``).join(", ");
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${payload.failedJobs.length === 1 ? "Failed job" : "Failed jobs"}:* ${jobs}`,
      },
    });
  }

  const actions: unknown[] = [
    {
      type: "button",
      text: { type: "plain_text", text: "View run", emoji: false },
      url: payload.runUrl,
      // Colours the button red on a failure — the one place Slack lets the
      // outcome be visible without reading.
      ...(payload.outcome === "failure" ? { style: "danger" } : {}),
    },
  ];

  if (payload.pullRequestNumber !== undefined) {
    actions.push({
      type: "button",
      text: { type: "plain_text", text: `PR #${payload.pullRequestNumber}` },
      url: `${repositoryUrl}/pull/${payload.pullRequestNumber}`,
    });
  }

  blocks.push({ type: "actions", elements: actions });

  return { text, blocks };
}

/**
 * The dedup key for a (repository, branch, job).
 *
 * Hashed once it would exceed the payload's 64-character cap rather than
 * truncated: two long branches sharing a prefix would truncate to the SAME
 * tag, and one would silently replace the other's notification in the tray —
 * a failure on a branch you are not looking at eating the one you are. A
 * digest is stable across runs, which is all a dedup key has to be.
 */
export function runTag(payload: CiNotifyPayload): string {
  const key = `${payload.repository}:${payload.branch}:${payload.job}`;
  if (key.length <= 60) return `ci:${key}`;
  return `ci:${createHash("sha256").update(key).digest("hex").slice(0, 32)}`;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`;
}
