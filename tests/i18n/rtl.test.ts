import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

/**
 * Physical-direction utilities do not flip under `dir="rtl"`: `ml-4` is always
 * a left margin, so an Arabic layout ends up with its spacing on the wrong
 * side. Tailwind's logical equivalents (`ms-4`) follow the writing direction.
 *
 * `components/ui/**` is exempt — those files are shadcn-generated and are
 * re-synced with `pnpm ui:diff` rather than hand-edited.
 */
const PHYSICAL = String.raw`\b(ml|mr|pl|pr)-[0-9.]|\b(left|right)-[0-9.]|\btext-(left|right)\b|\bborder-(l|r)\b|\brounded-(l|r)-`;

function grep(pattern: string, paths: string[]): string[] {
  try {
    const out = execFileSync(
      "grep",
      ["-rnoE", pattern, "--include=*.tsx", "--include=*.ts", ...paths],
      { encoding: "utf8" },
    );
    return out.trim().split("\n").filter(Boolean);
  } catch {
    // grep exits 1 when there are no matches, which is the passing case.
    return [];
  }
}

describe("RTL readiness", () => {
  it("uses logical direction utilities, not physical ones", () => {
    const hits = grep(PHYSICAL, ["app", "components/customs"]);
    expect(
      hits,
      `use ms-/me-/ps-/pe-/start-/end-/text-start instead:\n${hits.join("\n")}`,
    ).toEqual([]);
  });

  it("routes navigation through the locale-aware helpers", () => {
    // next/link and next/navigation's router drop the locale on client
    // transitions. useSearchParams and useParams have no locale-aware
    // counterpart and are allowed.
    const hits = grep(
      String.raw`from "next/link"|import \{[^}]*\b(useRouter|usePathname|redirect)\b[^}]*\} from "next/navigation"`,
      ["app", "components/customs"],
    );
    expect(
      hits,
      `import from @/i18n/navigation instead:\n${hits.join("\n")}`,
    ).toEqual([]);
  });

  it("keeps both locale catalogues loadable", async () => {
    const en = await import("@/messages/en.json");
    const ar = await import("@/messages/ar.json");
    expect(Object.keys(en.default).length).toBeGreaterThan(0);
    expect(Object.keys(ar.default)).toEqual(Object.keys(en.default));
  });
});
