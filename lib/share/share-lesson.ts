/**
 * Sharing a lesson, and counting only the shares that happened.
 *
 * #20 is explicit about the requirement, and it is the interesting one: most
 * implementations increment a counter when the share BUTTON is pressed, which
 * makes "shares" a click count. Opening the OS share sheet and dismissing it
 * is not a share, and a number that says otherwise is a number nobody should
 * quote.
 *
 * So this returns a discriminated outcome and the caller records only the
 * verified ones:
 *
 * | Path                                    | Counted | Why |
 * | --------------------------------------- | ------- | --- |
 * | `navigator.share()` resolves             | yes     | The sheet resolving means a target was picked. The strongest signal a browser gives. |
 * | `navigator.share()` rejects `AbortError` | no      | The user opened the sheet and dismissed it. Exactly the case the owner called out. |
 * | `navigator.share()` rejects otherwise    | no      | A failure is not a share. Falls back to the clipboard. |
 * | `clipboard.writeText()` resolves         | yes     | The link is on the clipboard — the fallback's definition of success. |
 * | `clipboard.writeText()` rejects          | no      | Show the URL to copy by hand, and count nothing. |
 * | An outbound social link                  | recorded, not counted | `window.open` to an intent URL tells us the user left. It cannot tell us they pressed Post — there is no callback and no way to observe another origin. Counting it would make the number a lie. |
 *
 * The consequence, accepted: the public count is lower than a click-counter's,
 * and on a desktop browser without `navigator.share` most shares land in the
 * clipboard bucket or go uncounted. A number that is smaller and true beats a
 * number that is bigger and meaningless.
 *
 * Pure enough to test: the Web APIs are read off an injectable object rather
 * than off the global, so a test can supply a `navigator.share` that rejects
 * with an `AbortError` and assert that nothing is recorded.
 */

export const SHARE_CHANNELS = [
  "web_share",
  "clipboard",
  "outbound_link",
] as const;

export type ShareChannel = (typeof SHARE_CHANNELS)[number];

export type ShareOutcome =
  /** The share happened. Record it; it counts. */
  | { outcome: "shared"; channel: "web_share" | "clipboard" }
  /** Recorded as intent, never counted — see the table above. */
  | { outcome: "opened"; channel: "outbound_link"; target: string }
  /** The user changed their mind. Record nothing. */
  | { outcome: "dismissed"; channel: ShareChannel }
  /** Something went wrong. Record nothing, and show the URL to copy. */
  | { outcome: "failed"; channel: ShareChannel };

/** Only these two are a share that a count may include. */
export function isCounted(result: ShareOutcome): boolean {
  return result.outcome === "shared";
}

/** The subset of the platform this needs, so a test can supply its own. */
export interface ShareEnvironment {
  share?: (data: {
    title: string;
    text?: string;
    url: string;
  }) => Promise<void>;
  writeText?: (text: string) => Promise<void>;
}

export function browserShareEnvironment(): ShareEnvironment {
  if (typeof navigator === "undefined") return {};
  return {
    // Bound, or `navigator.share` called detached throws an illegal-invocation
    // TypeError that would be indistinguishable here from a real failure.
    share: navigator.share ? navigator.share.bind(navigator) : undefined,
    writeText: navigator.clipboard
      ? navigator.clipboard.writeText.bind(navigator.clipboard)
      : undefined,
  };
}

export interface ShareRequest {
  title: string;
  text?: string;
  url: string;
}

/**
 * The share sheet, falling back to the clipboard.
 *
 * A dismissal does NOT fall back: the user has already said no, and putting
 * the link on their clipboard afterwards would both count a share they
 * declined and overwrite whatever they had copied.
 */
export async function shareLesson(
  request: ShareRequest,
  environment: ShareEnvironment = browserShareEnvironment(),
): Promise<ShareOutcome> {
  if (environment.share) {
    try {
      await environment.share(request);
      return { outcome: "shared", channel: "web_share" };
    } catch (error) {
      if (isAbort(error)) return { outcome: "dismissed", channel: "web_share" };
      // Anything else — NotAllowedError, a missing user gesture, a platform
      // with a share method that throws — is a failure of the sheet, not of
      // the intent, so the clipboard is still worth trying.
    }
  }

  return copyLink(request.url, environment);
}

export async function copyLink(
  url: string,
  environment: ShareEnvironment = browserShareEnvironment(),
): Promise<ShareOutcome> {
  if (!environment.writeText)
    return { outcome: "failed", channel: "clipboard" };

  try {
    await environment.writeText(url);
    return { outcome: "shared", channel: "clipboard" };
  } catch {
    // Permission denied, or an insecure context. The caller shows the URL in a
    // selectable field instead and counts nothing.
    return { outcome: "failed", channel: "clipboard" };
  }
}

/**
 * `AbortError` is how every browser reports "the user dismissed the sheet".
 *
 * Checked by `name`, not `instanceof DOMException`: Safari has shipped plain
 * Errors carrying the name, and a check that misses one turns a dismissal into
 * a counted share.
 */
function isAbort(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name?: unknown }).name === "AbortError"
  );
}

/** Where an outbound link can go. A closed list: the target is stored, and a
 * free-form one would be a column of whatever a caller passed. */
export const OUTBOUND_TARGETS = {
  x: (url: string, title: string) =>
    `https://x.com/intent/post?url=${encodeURIComponent(url)}&text=${encodeURIComponent(title)}`,
  whatsapp: (url: string, title: string) =>
    `https://wa.me/?text=${encodeURIComponent(`${title} ${url}`)}`,
  telegram: (url: string, title: string) =>
    `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(title)}`,
  facebook: (url: string) =>
    `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`,
} as const;

export type OutboundTarget = keyof typeof OUTBOUND_TARGETS;

export function isOutboundTarget(value: string): value is OutboundTarget {
  return Object.hasOwn(OUTBOUND_TARGETS, value);
}

export function outboundUrl(
  target: OutboundTarget,
  url: string,
  title: string,
): string {
  return OUTBOUND_TARGETS[target](url, title);
}
