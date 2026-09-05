/**
 * The numbers that define "online", in one place.
 *
 * The client's flicker tolerance and the server's window must not drift apart,
 * so the SQL view is generated from these and a test asserts the migration
 * still matches them. Two copies of "150 seconds" is two things to change and
 * one of them will be forgotten.
 */

/** How often a visible tab reports in. */
export const HEARTBEAT_MS = 60_000;

/**
 * Jitter, so returning users do not synchronise.
 *
 * Everybody's tab waking at the same second after a deploy or a network blip
 * is a thundering herd against one row per user — ±10% spreads it without
 * making the window meaningfully less accurate.
 */
export const HEARTBEAT_JITTER = 0.1;

/**
 * Online for 2.5 heartbeats.
 *
 * One dropped beat — a slow request, a moment of packet loss — must not flick
 * somebody offline and back. Two and a half intervals tolerates a missed beat
 * without making a closed browser look present for minutes.
 */
export const ONLINE_WINDOW_MS = 150_000;

/**
 * Away: a tab left open, or someone who stepped away.
 *
 * The distinction is worth drawing because "offline" on a learning site reads
 * as "gone", and somebody who was here four minutes ago has probably not gone.
 */
export const AWAY_WINDOW_MS = 15 * 60_000;

/**
 * The conditional write's floor.
 *
 * A beat that arrives sooner than this matches zero rows and costs nothing,
 * which is what caps writes at one per user per interval however many tabs,
 * retries or duplicate requests occur.
 */
export const WRITE_FLOOR_MS = 45_000;

/** Ids per batched read. A page cannot ask for the whole user table. */
export const MAX_PRESENCE_IDS = 100;

/** Seconds, for SQL intervals — the view is generated from these. */
export const ONLINE_WINDOW_SECONDS = ONLINE_WINDOW_MS / 1000;
export const AWAY_WINDOW_SECONDS = AWAY_WINDOW_MS / 1000;
export const WRITE_FLOOR_SECONDS = WRITE_FLOOR_MS / 1000;
