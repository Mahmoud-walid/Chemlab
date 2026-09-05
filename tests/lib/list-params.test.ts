import { describe, expect, it } from "vitest";

import {
  DEFAULT_PAGE_SIZE,
  listParamsToQuery,
  offsetFor,
  pageCount,
  parseListParams,
} from "@/db/queries/admin/list-params";

const spec = {
  sortable: ["number", "name", "symbol"] as const,
  defaultSort: "number" as const,
};

describe("parseListParams", () => {
  it("falls back to sane defaults when nothing is supplied", () => {
    expect(parseListParams({}, spec)).toEqual({
      page: 1,
      pageSize: DEFAULT_PAGE_SIZE,
      sort: "number",
      direction: "asc",
      query: "",
    });
  });

  it("reads a well-formed view", () => {
    expect(
      parseListParams(
        { page: "3", pageSize: "50", sort: "name", dir: "desc", q: " iron " },
        spec,
      ),
    ).toEqual({
      page: 3,
      pageSize: 50,
      sort: "name",
      direction: "desc",
      query: "iron",
    });
  });

  it("rejects a sort column that is not on the allow-list", () => {
    // The value names a column and ends up in an ORDER BY. Passing it through
    // is how a query string becomes SQL injection.
    expect(parseListParams({ sort: "password" }, spec).sort).toBe("number");
    expect(parseListParams({ sort: "name; drop table users" }, spec).sort).toBe(
      "number",
    );
  });

  it("clamps a nonsensical page or page size to the default", () => {
    for (const page of ["0", "-4", "abc", "1.5", ""]) {
      expect(parseListParams({ page }, spec).page, page).toBe(1);
    }
    // Off-menu sizes are a probe or a typo; either way the answer is the
    // default rather than a 10000-row query.
    for (const pageSize of ["7", "10000", "-1", "abc"]) {
      expect(parseListParams({ pageSize }, spec).pageSize, pageSize).toBe(
        DEFAULT_PAGE_SIZE,
      );
    }
  });

  it("caps the search term", () => {
    const long = "x".repeat(500);
    expect(parseListParams({ q: long }, spec).query).toHaveLength(100);
  });

  it("takes the first value when a parameter is repeated", () => {
    expect(parseListParams({ page: ["2", "9"] }, spec).page).toBe(2);
  });
});

describe("listParamsToQuery", () => {
  it("omits everything that is already the default", () => {
    expect(listParamsToQuery({ page: 1, sort: "number" }, spec)).toBe("");
  });

  it("serialises only what differs", () => {
    expect(
      listParamsToQuery({ page: 2, sort: "name", direction: "desc" }, spec),
    ).toBe("?page=2&sort=name&dir=desc");
  });

  it("round-trips through parseListParams", () => {
    const params = {
      page: 4,
      pageSize: 50,
      sort: "symbol" as const,
      direction: "desc" as const,
      query: "he",
    };
    const query = listParamsToQuery(params, spec);
    const parsed = parseListParams(
      Object.fromEntries(new URLSearchParams(query.slice(1))),
      spec,
    );
    expect(parsed).toEqual(params);
  });
});

describe("pageCount / offsetFor", () => {
  it("always offers at least one page, even with no rows", () => {
    expect(pageCount(0, 25)).toBe(1);
    expect(pageCount(119, 25)).toBe(5);
    expect(pageCount(25, 25)).toBe(1);
  });

  it("computes the offset for a page", () => {
    expect(offsetFor(1, 25, 119)).toBe(0);
    expect(offsetFor(3, 25, 119)).toBe(50);
  });

  it("clamps past the last page instead of returning an empty view", () => {
    // ?page=999 on a 5-page table should show the last page, not nothing.
    expect(offsetFor(999, 25, 119)).toBe(100);
    expect(offsetFor(999, 25, 0)).toBe(0);
  });
});
