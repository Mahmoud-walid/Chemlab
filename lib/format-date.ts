/**
 * Date formatting built on `Intl.DateTimeFormat`.
 *
 * The platform previously pulled six date packages (moment, moment-timezone,
 * dayjs, date-fns, chrono-node and @syntaxsentinel/date-utils) for a single
 * display-formatting call. `Intl` is built into the runtime, costs no bundle
 * bytes, and localises for free — which matters because the UI is going
 * bilingual (English and Arabic).
 */

export interface FormatDateOptions {
  /** BCP 47 tag. Defaults to the runtime locale. */
  locale?: string;
  /** IANA time zone. Defaults to the runtime zone. */
  timeZone?: string;
}

function toDate(value: Date | string | number): Date {
  return value instanceof Date ? value : new Date(value);
}

/**
 * Short display date, e.g. `Mar 17, 2026` in `en-US`.
 *
 * Matches the output of the `MMM DD, YYYY` format it replaces, including the
 * zero-padded day, so existing rendered pages are unchanged.
 */
export function formatShortDate(
  value: Date | string | number,
  { locale, timeZone }: FormatDateOptions = {},
): string {
  const date = toDate(value);
  if (Number.isNaN(date.getTime())) return "";

  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "2-digit",
    year: "numeric",
    timeZone,
  }).format(date);
}

/** Long display date, e.g. `17 March 2026`. */
export function formatLongDate(
  value: Date | string | number,
  { locale, timeZone }: FormatDateOptions = {},
): string {
  const date = toDate(value);
  if (Number.isNaN(date.getTime())) return "";

  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone,
  }).format(date);
}

/** Date and time, e.g. `Mar 17, 2026, 10:30 AM`. */
export function formatDateTime(
  value: Date | string | number,
  { locale, timeZone }: FormatDateOptions = {},
): string {
  const date = toDate(value);
  if (Number.isNaN(date.getTime())) return "";

  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  }).format(date);
}
