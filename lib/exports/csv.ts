/**
 * CSV encoding, kept pure so it can be tested a row at a time.
 *
 * The format is RFC 4180 with two deliberate departures, both about the
 * program that will actually open the file:
 *
 * 1. **CRLF line endings.** Excel on Windows treats a bare LF inside a quoted
 *    field as the end of the record; CRLF is what every spreadsheet agrees on.
 *
 * 2. **Formula neutralisation.** A cell whose text begins `=`, `+`, `-`, `@`
 *    or a control character is executed as a formula by Excel, Sheets and
 *    LibreOffice. That is not a theoretical problem here: `user_agent` and a
 *    void `reason` are attacker-supplied free text, and an export is opened by
 *    exactly the person with the most access. `=cmd|' /c calc'!A0` in a user
 *    agent is a shell command in an administrator's spreadsheet. Prefixing a
 *    single quote is the standard neutralisation and it is applied to the
 *    value BEFORE quoting, so the escape survives the encoding.
 *
 * The BOM is the third concession: without it Excel reads UTF-8 as the local
 * code page and every Arabic column becomes mojibake. The site is bilingual,
 * so the BOM is not optional.
 */

/** Excel reads a file without this as the system code page, not as UTF-8. */
export const UTF8_BOM = "﻿";

const NEEDS_QUOTING = /[",\r\n]/;
/** The characters a spreadsheet reads as "this cell is a formula". */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

/**
 * One cell.
 *
 * `null` and `undefined` become empty rather than the strings "null" and
 * "undefined" — a blank cell is what a missing value means to a reader, and
 * "null" is what it means to a programmer only.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";

  const text =
    value instanceof Date
      ? // ISO 8601, UTC. A locale-formatted date in an export is unsortable
        // and ambiguous — 03/04 is two different days depending on who reads
        // it. The screen formats dates for people; the file is for machines.
        value.toISOString()
      : typeof value === "boolean"
        ? value
          ? "true"
          : "false"
        : String(value);

  const safe = FORMULA_LEAD.test(text) ? `'${text}` : text;

  return NEEDS_QUOTING.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

/** One record, terminated. Terminated rather than joined, so a stream can
 * emit rows one at a time without tracking whether it is on the first. */
export function csvRow(values: readonly unknown[]): string {
  return `${values.map(csvCell).join(",")}\r\n`;
}

/**
 * The whole file, for small fixed tables (the funnel) and for tests.
 * Anything unbounded streams instead — see `db/queries/admin/export.ts`.
 */
export function csvDocument(
  header: readonly string[],
  rows: readonly (readonly unknown[])[],
): string {
  return UTF8_BOM + csvRow(header) + rows.map(csvRow).join("");
}

/**
 * A `Content-Disposition` value that survives a non-ASCII site name.
 *
 * Both forms are sent: `filename=` for old clients, `filename*=` with RFC 5987
 * percent-encoding for everything since. Quotes, backslashes and control
 * characters are stripped from the ASCII form rather than escaped — a header
 * injected through a filename is a worse bug than an ugly download name.
 */
export function contentDisposition(filename: string): string {
  const ascii = filename
    .replaceAll(/["\\\r\n]/g, "")
    .replaceAll(/[^\x20-\x7e]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/** `chemlab-activity-2026-09-05.csv` — dataset and day, so two downloads in
 * a row do not land as `export (1).csv`. */
export function exportFilename(dataset: string, now: Date): string {
  return `chemlab-${dataset}-${now.toISOString().slice(0, 10)}.csv`;
}
