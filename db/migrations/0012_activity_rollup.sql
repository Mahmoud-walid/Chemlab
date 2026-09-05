-- Pre-aggregated activity, so dashboards never scan the raw event table.
--
-- A rollup TABLE rather than a materialised view: `REFRESH MATERIALIZED VIEW
-- CONCURRENTLY` re-computes everything on a schedule we do not control, while
-- a table is incrementally updatable with ON CONFLICT DO UPDATE and can be
-- re-run for one day without touching the rest.
--
-- `object_type` and `object_id` are NOT NULL with an empty-string default,
-- which is the load-bearing part: Postgres treats NULLs in a primary key as
-- distinct, so a nullable pair would let the same (day, verb) be inserted over
-- and over and quietly break the idempotency the whole design depends on.
CREATE TABLE "activity_daily_rollup" (
	"day" date NOT NULL,
	"verb" "activity_verb" NOT NULL,
	"object_type" text DEFAULT '' NOT NULL,
	"object_id" text DEFAULT '' NOT NULL,
	"event_count" integer NOT NULL,
	"unique_actors" integer NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activity_daily_rollup_day_verb_object_type_object_id_pk" PRIMARY KEY("day","verb","object_type","object_id")
);
--> statement-breakpoint
CREATE INDEX "activity_rollup_day_idx" ON "activity_daily_rollup" USING btree ("day");