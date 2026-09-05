CREATE TYPE "public"."presence_visibility" AS ENUM('everyone', 'nobody');--> statement-breakpoint
CREATE TABLE "user_presence" (
	"user_id" text PRIMARY KEY NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_path" text
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "presence_visibility" "presence_visibility" DEFAULT 'everyone' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_presence" ADD CONSTRAINT "user_presence_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_presence_last_seen_idx" ON "user_presence" USING btree ("last_seen_at" DESC NULLS LAST);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Room for HOT updates.
--
-- `last_seen_at` is rewritten once per online user per minute, and the read
-- path needs an index on it — which is exactly the combination that produces
-- index bloat, because an update that cannot fit in the same page has to write
-- a new index entry. `fillfactor = 70` leaves a third of each page free so most
-- of those updates stay heap-only.
-- ---------------------------------------------------------------------------
ALTER TABLE "user_presence" SET (fillfactor = 70);
--> statement-breakpoint
CREATE OR REPLACE VIEW presence_state AS
SELECT p.user_id,
       CASE
         WHEN u.presence_visibility = 'nobody' THEN 'offline'
         WHEN now() - p.last_seen_at < interval '150 seconds' THEN 'online'
         WHEN now() - p.last_seen_at < interval '900 seconds' THEN 'away'
         ELSE 'offline'
       END AS state,
       CASE
         WHEN u.presence_visibility = 'nobody' THEN NULL
         ELSE p.last_seen_at
       END AS last_seen_at,
       p.last_path
FROM user_presence p
JOIN users u ON u.id = p.user_id;
