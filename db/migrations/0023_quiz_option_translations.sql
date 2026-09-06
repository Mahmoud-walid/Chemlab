-- Translatable answer options.
--
-- Until this table, a quiz could be translated and still render an Arabic
-- question above English answer options: `quiz_option_translations` did not
-- exist, and the sitting query reads `quiz_options.label` directly. That is
-- worse than serving the whole quiz in English — the reader cannot tell
-- whether they got it wrong or merely could not read the choices.
--
-- `is_correct` is absent from this table on purpose. Which option is right is
-- not a property of the language it is written in, and a per-locale answer key
-- is how a quiz comes to grade differently in Arabic than in English.
--
-- `quiz_options` gains its own `source_hash` rather than the question's hash
-- growing to cover the options. Every translatable row hashes exactly its own
-- fields and every translation row compares against its own parent — the same
-- shape lessons and sections already use — so retyping one option's label
-- marks that option stale and leaves its three siblings, and the question,
-- alone. A generated column could not reach `quiz_options` from
-- `quiz_questions` in any case: the expression must be IMMUTABLE, and a
-- subquery is not.
--> statement-breakpoint
CREATE TABLE "quiz_option_translations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"option_id" uuid NOT NULL,
	"locale" text NOT NULL,
	"label" text NOT NULL,
	"status" "translation_status" DEFAULT 'draft' NOT NULL,
	"translated_by" text,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"source_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "quiz_options" ADD COLUMN "source_hash" text GENERATED ALWAYS AS (md5(label)) STORED NOT NULL;--> statement-breakpoint
ALTER TABLE "quiz_option_translations" ADD CONSTRAINT "quiz_option_translations_option_id_quiz_options_id_fk" FOREIGN KEY ("option_id") REFERENCES "public"."quiz_options"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_option_translations" ADD CONSTRAINT "quiz_option_translations_translated_by_users_id_fk" FOREIGN KEY ("translated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_option_translations" ADD CONSTRAINT "quiz_option_translations_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "quiz_option_translations_locale_idx" ON "quiz_option_translations" USING btree ("option_id","locale");