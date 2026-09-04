CREATE TYPE "public"."difficulty" AS ENUM('easy', 'medium', 'hard');--> statement-breakpoint
CREATE TABLE "elements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"number" integer NOT NULL,
	"symbol" text NOT NULL,
	"name" text NOT NULL,
	"atomic_mass" double precision NOT NULL,
	"category" text NOT NULL,
	"period" integer NOT NULL,
	"xpos" integer NOT NULL,
	"ypos" integer NOT NULL,
	"phase" text NOT NULL,
	"appearance" text,
	"color" text,
	"density" double precision,
	"melt" double precision,
	"boil" double precision,
	"molar_heat" double precision,
	"electron_affinity" double precision,
	"electronegativity_pauling" double precision,
	"electron_configuration" text NOT NULL,
	"electron_configuration_semantic" text NOT NULL,
	"shells" integer[] NOT NULL,
	"ionization_energies" double precision[] NOT NULL,
	"summary" text NOT NULL,
	"source" text NOT NULL,
	"spectral_img" text,
	"discovered_by" text,
	"named_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "elements_number_unique" UNIQUE("number"),
	CONSTRAINT "elements_symbol_unique" UNIQUE("symbol")
);
--> statement-breakpoint
CREATE TABLE "lesson_section_translations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"section_id" uuid NOT NULL,
	"locale" text NOT NULL,
	"heading" text NOT NULL,
	"body" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lesson_sections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"lesson_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"heading" text NOT NULL,
	"body" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lesson_translations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"lesson_id" uuid NOT NULL,
	"locale" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lessons" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"difficulty" "difficulty" NOT NULL,
	"category" text NOT NULL,
	"references" text[] DEFAULT '{}' NOT NULL,
	"published_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lessons_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "quiz_options" (
	"id" uuid PRIMARY KEY NOT NULL,
	"question_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"label" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quiz_question_translations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"question_id" uuid NOT NULL,
	"locale" text NOT NULL,
	"prompt" text NOT NULL,
	"explanation" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quiz_questions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"quiz_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"prompt" text NOT NULL,
	"explanation" text NOT NULL,
	"correct_option_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quiz_translations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"quiz_id" uuid NOT NULL,
	"locale" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quizzes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"difficulty" "difficulty" NOT NULL,
	"category" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quizzes_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "lesson_section_translations" ADD CONSTRAINT "lesson_section_translations_section_id_lesson_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."lesson_sections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_sections" ADD CONSTRAINT "lesson_sections_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_translations" ADD CONSTRAINT "lesson_translations_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_options" ADD CONSTRAINT "quiz_options_question_id_quiz_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."quiz_questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_question_translations" ADD CONSTRAINT "quiz_question_translations_question_id_quiz_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."quiz_questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_questions" ADD CONSTRAINT "quiz_questions_quiz_id_quizzes_id_fk" FOREIGN KEY ("quiz_id") REFERENCES "public"."quizzes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_translations" ADD CONSTRAINT "quiz_translations_quiz_id_quizzes_id_fk" FOREIGN KEY ("quiz_id") REFERENCES "public"."quizzes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "elements_xy_idx" ON "elements" USING btree ("xpos","ypos");--> statement-breakpoint
CREATE UNIQUE INDEX "lesson_section_translations_locale_idx" ON "lesson_section_translations" USING btree ("section_id","locale");--> statement-breakpoint
CREATE UNIQUE INDEX "lesson_sections_order_idx" ON "lesson_sections" USING btree ("lesson_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "lesson_translations_locale_idx" ON "lesson_translations" USING btree ("lesson_id","locale");--> statement-breakpoint
CREATE UNIQUE INDEX "quiz_options_order_idx" ON "quiz_options" USING btree ("question_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "quiz_question_translations_locale_idx" ON "quiz_question_translations" USING btree ("question_id","locale");--> statement-breakpoint
CREATE UNIQUE INDEX "quiz_questions_order_idx" ON "quiz_questions" USING btree ("quiz_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "quiz_translations_locale_idx" ON "quiz_translations" USING btree ("quiz_id","locale");