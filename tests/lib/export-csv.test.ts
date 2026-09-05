import { describe, expect, it } from "vitest";

import {
  contentDisposition,
  csvCell,
  csvDocument,
  csvRow,
  exportFilename,
  UTF8_BOM,
} from "@/lib/exports/csv";

describe("csvCell", () => {
  it("leaves an ordinary value alone", () => {
    expect(csvCell("lesson.viewed")).toBe("lesson.viewed");
    expect(csvCell(42)).toBe("42");
  });

  it("writes a missing value as blank, not as the word null", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });

  it("quotes commas, quotes and newlines, doubling the quotes", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("one\r\ntwo")).toBe('"one\r\ntwo"');
  });

  it("writes dates as ISO 8601 in UTC, so the file sorts", () => {
    expect(csvCell(new Date("2026-09-05T09:38:00.000Z"))).toBe(
      "2026-09-05T09:38:00.000Z",
    );
  });

  // The reason this module exists. A user agent is attacker-supplied text and
  // the person opening the export is the one with the most access.
  it.each(["=cmd|' /c calc'!A0", "+1+1", "-2+3", "@SUM(A1)", "\tsneaky"])(
    "neutralises %s so a spreadsheet reads it as text",
    (payload) => {
      const cell = csvCell(payload);
      expect(cell.startsWith("'") || cell.startsWith("\"'")).toBe(true);
    },
  );

  it("keeps the neutralising quote inside the quoting, not outside it", () => {
    // A formula that also contains a comma must come out as "'=a,b" — the
    // apostrophe belongs to the VALUE, so quoting has to wrap it.
    expect(csvCell("=a,b")).toBe('"\'=a,b"');
  });

  it("does not mangle an ordinary negative number written as a number", () => {
    // Numbers arrive as numbers from the database; only text that LOOKS like
    // a formula is prefixed. A stringified -5 is indistinguishable from a
    // typed formula, so it is prefixed too — deliberately, and asserted here
    // so the trade-off cannot change silently.
    expect(csvCell(-5)).toBe("'-5");
  });
});

describe("csvRow", () => {
  it("terminates with CRLF so Excel agrees where the record ends", () => {
    expect(csvRow(["a", "b"])).toBe("a,b\r\n");
  });
});

describe("csvDocument", () => {
  it("starts with the BOM, or Excel reads Arabic as mojibake", () => {
    const doc = csvDocument(["verb"], [["درس"]]);
    expect(doc.startsWith(UTF8_BOM)).toBe(true);
    expect(doc).toContain("درس");
  });

  it("puts the header first and one row per record", () => {
    const doc = csvDocument(
      ["a", "b"],
      [
        [1, 2],
        [3, 4],
      ],
    );
    expect(doc.slice(UTF8_BOM.length)).toBe("a,b\r\n1,2\r\n3,4\r\n");
  });
});

describe("contentDisposition", () => {
  it("sends both an ASCII name and the encoded one", () => {
    const header = contentDisposition("chemlab-events-2026-09-05.csv");
    expect(header).toContain('filename="chemlab-events-2026-09-05.csv"');
    expect(header).toContain("filename*=UTF-8''chemlab-events");
  });

  it("cannot be used to inject a second header", () => {
    const header = contentDisposition('a"\r\nX-Evil: 1.csv');
    expect(header).not.toContain("\r");
    expect(header).not.toContain("\n");
    // The residual text is harmless once the CR, LF and quote are gone: a
    // header value cannot be split without them, so what is left is an ugly
    // download name rather than a second header.
    expect(header).not.toContain('"a"');
  });
});

describe("exportFilename", () => {
  it("names the dataset and the day", () => {
    expect(exportFilename("events", new Date("2026-09-05T23:00:00Z"))).toBe(
      "chemlab-events-2026-09-05.csv",
    );
  });
});
