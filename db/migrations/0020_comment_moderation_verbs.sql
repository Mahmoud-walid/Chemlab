ALTER TYPE "public"."activity_verb" ADD VALUE 'comment.hidden' BEFORE 'exam.started';--> statement-breakpoint
ALTER TYPE "public"."activity_verb" ADD VALUE 'comment.removed' BEFORE 'exam.started';--> statement-breakpoint
ALTER TYPE "public"."activity_verb" ADD VALUE 'comment.restored' BEFORE 'exam.started';--> statement-breakpoint
ALTER TYPE "public"."activity_verb" ADD VALUE 'comment.dismissed' BEFORE 'exam.started';