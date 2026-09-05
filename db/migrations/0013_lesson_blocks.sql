ALTER TABLE "lessons" ADD COLUMN "reading_time_seconds" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "lessons" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
-- The section body stops being a ProseMirror document and becomes an ordered
-- array of typed blocks (see lib/lessons/blocks.ts). Both are jsonb, so the
-- column type does not change — the SHAPE does, and every existing row has to
-- be rewritten or every lesson renders blank.
--
-- The conversion is exhaustive for what the seed can have written: a doc whose
-- content is a list of paragraphs, each holding text nodes. Anything else is
-- left as an empty array rather than guessed at, because a half-converted
-- paragraph is prose with words missing, which is worse than a section an
-- editor can see is empty and refill.
--
-- Block ids are derived from the lesson's slug, the section's position and the
-- paragraph's position — never generated. Two reasons: a translation addresses
-- a block by id, so a random id would orphan every translation on a restore;
-- and this is the SAME rule `textToBlocks` in db/seed/transform.ts follows, so
-- a re-seed rewrites each body to identical ids rather than to new ones.
UPDATE "lesson_sections" SET "body" = (
  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', (
          SELECT l."slug" FROM "lessons" l WHERE l."id" = "lesson_sections"."lesson_id"
        ) || '-s' || ("lesson_sections"."position" + 1)::text || '-p' || node.ord::text,
        'type', 'paragraph',
        'text', coalesce(
          (
            SELECT jsonb_agg(jsonb_build_object('text', run->>'text'))
            FROM jsonb_array_elements(node.value->'content') AS run
            WHERE run->>'type' = 'text' AND coalesce(run->>'text', '') <> ''
          ),
          '[]'::jsonb
        )
      )
      ORDER BY node.ord
    ),
    '[]'::jsonb
  )
  FROM jsonb_array_elements("lesson_sections"."body"->'content')
       WITH ORDINALITY AS node(value, ord)
  WHERE node.value->>'type' = 'paragraph'
)
-- Only rows still in the old shape. Re-running this migration against an
-- already-converted table would otherwise read `->'content'` on an array and
-- blank every body.
WHERE jsonb_typeof("body") = 'object' AND "body" ? 'content';--> statement-breakpoint
-- A translated body is the same shape and needs the same conversion.
UPDATE "lesson_section_translations" SET "body" = (
  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', (
          SELECT l."slug" || '-s' || (s."position" + 1)::text
          FROM "lesson_sections" s
          JOIN "lessons" l ON l."id" = s."lesson_id"
          WHERE s."id" = "lesson_section_translations"."section_id"
        ) || '-p' || node.ord::text,
        'type', 'paragraph',
        'text', coalesce(
          (
            SELECT jsonb_agg(jsonb_build_object('text', run->>'text'))
            FROM jsonb_array_elements(node.value->'content') AS run
            WHERE run->>'type' = 'text' AND coalesce(run->>'text', '') <> ''
          ),
          '[]'::jsonb
        )
      )
      ORDER BY node.ord
    ),
    '[]'::jsonb
  )
  FROM jsonb_array_elements("lesson_section_translations"."body"->'content')
       WITH ORDINALITY AS node(value, ord)
  WHERE node.value->>'type' = 'paragraph'
)
WHERE jsonb_typeof("body") = 'object' AND "body" ? 'content';--> statement-breakpoint
-- Anything that was neither shape (an empty object, a stray value) becomes an
-- empty body rather than staying unrenderable.
UPDATE "lesson_sections" SET "body" = '[]'::jsonb WHERE jsonb_typeof("body") <> 'array';--> statement-breakpoint
UPDATE "lesson_section_translations" SET "body" = '[]'::jsonb WHERE jsonb_typeof("body") <> 'array';--> statement-breakpoint
-- The shape is now an invariant of the table, not a convention the application
-- remembers. A future writer that stores an object here fails loudly.
ALTER TABLE "lesson_sections"
  ADD CONSTRAINT "lesson_sections_body_is_array" CHECK (jsonb_typeof("body") = 'array');--> statement-breakpoint
ALTER TABLE "lesson_section_translations"
  ADD CONSTRAINT "lesson_section_translations_body_is_array" CHECK (jsonb_typeof("body") = 'array');
