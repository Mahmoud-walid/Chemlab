CREATE TYPE "public"."ci_outcome" AS ENUM('success', 'failure', 'cancelled');--> statement-breakpoint
CREATE TABLE "ci_notification_preferences" (
	"user_id" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"branches" jsonb DEFAULT '["main"]'::jsonb NOT NULL,
	"notify_on_failure" boolean DEFAULT true NOT NULL,
	"success_policy" text DEFAULT 'recovery' NOT NULL,
	"notify_on_cancelled" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ci_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"repository" text NOT NULL,
	"branch" text NOT NULL,
	"job" text DEFAULT 'ci' NOT NULL,
	"commit_sha" text NOT NULL,
	"commit_message" text DEFAULT '' NOT NULL,
	"outcome" "ci_outcome" NOT NULL,
	"failed_jobs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"actor" text,
	"run_url" text NOT NULL,
	"pull_request_number" integer,
	"duration_seconds" integer,
	"notified" boolean DEFAULT false NOT NULL,
	"suppression_reason" text,
	"pushes_queued" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ci_notification_preferences" ADD CONSTRAINT "ci_notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ci_runs_branch_idx" ON "ci_runs" USING btree ("repository","branch","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "ci_runs_run_idx" ON "ci_runs" USING btree ("repository","run_url","job");