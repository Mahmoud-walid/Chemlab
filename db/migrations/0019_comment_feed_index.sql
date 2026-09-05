ALTER TYPE "public"."activity_verb" ADD VALUE 'comment.hidden' BEFORE 'exam.started';--> statement-breakpoint
ALTER TYPE "public"."activity_verb" ADD VALUE 'comment.removed' BEFORE 'exam.started';--> statement-breakpoint
ALTER TYPE "public"."activity_verb" ADD VALUE 'comment.restored' BEFORE 'exam.started';--> statement-breakpoint
ALTER TYPE "public"."activity_verb" ADD VALUE 'comment.dismissed' BEFORE 'exam.started';--> statement-breakpoint
DROP INDEX "comments_feed_idx";--> statement-breakpoint
DROP INDEX "comments_replies_idx";--> statement-breakpoint
CREATE INDEX "comments_feed_idx" ON "comments" USING btree ("subject_type","subject_id","id" DESC NULLS LAST) WHERE depth = 0 and status in ('visible', 'flagged');--> statement-breakpoint
CREATE INDEX "comments_replies_idx" ON "comments" USING btree ("parent_id","id");