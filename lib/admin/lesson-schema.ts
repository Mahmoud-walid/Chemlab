import { z } from "zod";

/**
 * Validation and lifecycle rules for the lesson editor, shared by the form and
 * the server action.
 *
 * The form's copy is for the person typing. The server's copy is the one that
 * decides, because a client can post anything.
 *
 * Pure — no database, no `server-only` — so the rules can be tested directly
 * and the same schema can run in the browser for immediate feedback.
 */

/** Text that means "unset" when blank, rather than an empty string. */
const optionalText = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((value) => {
    const trimmed = (value ?? "").trim();
    return trimmed === "" ? null : trimmed;
  });

/**
 * A URL, or nothing.
 *
 * Only http(s) is accepted. `javascript:` and `data:` URLs parse perfectly
 * well as URLs and would be rendered into an `<img src>` — an editor field is
 * not the place to find out that the URL scheme was never checked.
 */
const optionalUrl = optionalText.refine(
  (value) => {
    if (value === null) return true;
    try {
      return ["http:", "https:"].includes(new URL(value).protocol);
    } catch {
      return false;
    }
  },
  { message: "Enter a full http(s) URL, or leave it empty." },
);

/**
 * References, one per line.
 *
 * Order is preserved and duplicates are kept: a citation list is the author's
 * sequence, and two entries that look alike may differ by page number.
 */
const referenceList = z
  .union([z.string(), z.array(z.string()), z.undefined(), z.null()])
  .transform((value) => {
    const parts = Array.isArray(value) ? value : (value ?? "").split("\n");
    return parts.map((part) => part.trim()).filter(Boolean);
  });

/**
 * Tags, comma-separated.
 *
 * Unlike references, these ARE de-duplicated, case-insensitively: "Acids" and
 * "acids" are one tag typed twice, and keeping both would split the same
 * filter into two. The first spelling wins, so the author's capitalisation
 * survives.
 */
const tagList = z
  .union([z.string(), z.array(z.string()), z.undefined(), z.null()])
  .transform((value) => {
    const parts = Array.isArray(value) ? value : (value ?? "").split(",");
    const seen = new Set<string>();
    const tags: string[] = [];
    for (const part of parts) {
      const tag = part.trim();
      if (!tag) continue;
      const key = tag.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      tags.push(tag);
    }
    return tags;
  })
  .refine((tags) => tags.length <= 20, {
    message: "Twenty tags is already more than anyone will filter by.",
  });

/**
 * The slug.
 *
 * Lowercase, hyphen-separated, no leading or trailing hyphen — it is a public
 * URL segment, and a slug with a space or a capital in it is a link that works
 * in one place and 404s in another. Validated rather than silently rewritten:
 * an author who typed "Acids & Bases" should be told what the URL will be, not
 * have one chosen for them behind their back.
 */
/**
 * Slugs the admin router has already claimed.
 *
 * `/admin/lessons/new` is the create screen, and a static segment wins over a
 * dynamic one — so a lesson slugged "new" would exist, appear in the list, and
 * be the one lesson nobody could open. Refused at the point of naming rather
 * than discovered later.
 */
const RESERVED_SLUGS = new Set(["new"]);

export const lessonSlug = z
  .string()
  .trim()
  .min(1, { message: "Enter a slug." })
  .max(80, { message: "Slugs are at most 80 characters." })
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message:
      "Use lowercase letters, numbers and single hyphens — for example acids-and-bases.",
  })
  .refine((value) => !RESERVED_SLUGS.has(value), {
    message: "That slug is reserved. Choose another.",
  });

/** A suggestion for the slug field, offered to the author rather than imposed. */
export function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .normalize("NFKD")
      // Strip combining marks, so "Réactions" suggests "reactions" rather than
      // dropping the accented letter entirely.
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80)
      .replace(/-+$/g, "")
  );
}

export const lessonEditSchema = z.object({
  slug: lessonSlug,
  title: z
    .string()
    .trim()
    .min(1, { message: "Enter a title." })
    .max(160, { message: "Titles are at most 160 characters." }),
  description: z
    .string()
    .trim()
    .min(1, { message: "Enter a description." })
    .max(500, { message: "Descriptions are at most 500 characters." }),
  difficulty: z.enum(["easy", "medium", "hard"], {
    message: "Choose easy, medium or hard.",
  }),
  category: z
    .string()
    .trim()
    .min(1, { message: "Enter a category." })
    .max(80, { message: "Categories are at most 80 characters." }),
  coverImageUrl: optionalUrl,
  references: referenceList,
  tags: tagList,
  position: z
    .union([z.string(), z.number()])
    .transform((value) =>
      typeof value === "number" ? value : Number(String(value).trim() || "0"),
    )
    .refine(
      (value) => Number.isInteger(value) && value >= 0 && value <= 10000,
      {
        message: "Position is a whole number between 0 and 10000.",
      },
    ),
});

export type LessonEditInput = z.infer<typeof lessonEditSchema>;

/**
 * Why a lesson cannot be published yet, as message keys.
 *
 * Keys rather than English sentences: this is the one string in the lifecycle
 * a reader acts on, so it has to arrive in their language. The set is closed
 * and small, which is what makes keys practical here — the field-level
 * validation messages above are still English, and moving those is its own
 * change rather than a detour inside this one.
 *
 * Empty means publishable.
 */
export type PublishBlocker =
  | "missingTitle"
  | "missingDescription"
  | "missingCategory"
  | "missingBody"
  | "deleted";

export interface PublishCandidate {
  title: string;
  description: string;
  category: string;
  /** How many sections the lesson has. Zero is a lesson with nothing to read. */
  sectionCount: number;
  deletedAt: Date | null;
}

export function publishBlockers(lesson: PublishCandidate): PublishBlocker[] {
  const blockers: PublishBlocker[] = [];

  if (lesson.deletedAt !== null) blockers.push("deleted");
  if (lesson.title.trim() === "") blockers.push("missingTitle");
  if (lesson.description.trim() === "") blockers.push("missingDescription");
  if (lesson.category.trim() === "") blockers.push("missingCategory");
  // The criterion from #16: a lesson with an empty body cannot be published.
  // Twelve of the thirteen seeded lessons have no sections yet, so this makes
  // unpublishing one a decision that cannot be undone until the rich-body
  // editor lands. The list screen therefore shows the state up front rather
  // than letting it surface as a refusal after the fact.
  if (lesson.sectionCount === 0) blockers.push("missingBody");

  return blockers;
}
