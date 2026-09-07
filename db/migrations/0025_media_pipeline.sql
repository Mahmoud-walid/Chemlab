CREATE TYPE "public"."media_resource_type" AS ENUM('image', 'video', 'raw');--> statement-breakpoint
CREATE TYPE "public"."media_status" AS ENUM('pending', 'ready', 'failed', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."media_usage_kind" AS ENUM('lesson_block', 'lesson_cover', 'question', 'answer_option', 'avatar');--> statement-breakpoint
CREATE TABLE "media" (
	"id" uuid PRIMARY KEY NOT NULL,
	"public_id" text NOT NULL,
	"resource_type" "media_resource_type" NOT NULL,
	"delivery_type" text DEFAULT 'upload' NOT NULL,
	"format" text,
	"width" integer,
	"height" integer,
	"duration_ms" integer,
	"bytes" bigint,
	"poster_public_id" text,
	"blur_data_url" text,
	"alt" text,
	"original_filename" text,
	"environment" text NOT NULL,
	"folder" text NOT NULL,
	"owner_id" text,
	"status" "media_status" DEFAULT 'pending' NOT NULL,
	"checksum" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "media_usages" (
	"media_id" uuid NOT NULL,
	"kind" "media_usage_kind" NOT NULL,
	"entity_id" text NOT NULL,
	"block_id" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_usages_pkey" PRIMARY KEY("media_id","kind","entity_id","block_id")
);
--> statement-breakpoint
CREATE TABLE "user_media_quota" (
	"user_id" text PRIMARY KEY NOT NULL,
	"bytes_used" bigint DEFAULT 0 NOT NULL,
	"bytes_limit" bigint NOT NULL,
	"uploads_today" integer DEFAULT 0 NOT NULL,
	"window_started_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_usages" ADD CONSTRAINT "media_usages_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_media_quota" ADD CONSTRAINT "user_media_quota_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "media_public_id_idx" ON "media" USING btree ("public_id");--> statement-breakpoint
CREATE INDEX "media_owner_idx" ON "media" USING btree ("owner_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "media_gc_idx" ON "media" USING btree ("status","created_at") WHERE deleted_at is null;--> statement-breakpoint
CREATE INDEX "media_usages_entity_idx" ON "media_usages" USING btree ("kind","entity_id");