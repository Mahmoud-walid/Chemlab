CREATE TABLE "pages" (
	"route_key" text PRIMARY KEY NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"maintenance_message" jsonb,
	"show_in_nav" boolean DEFAULT true NOT NULL,
	"disabled_at" timestamp with time zone,
	"disabled_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Seeded here rather than by the seed script.
--
-- A route with no row has no switch, and the proxy treats "no row" as open —
-- which is the safe default, but it means a page shipped without a row is a
-- page the operator cannot take down. Creating the rows in the same migration
-- that creates the table is what makes the switch true the moment it exists,
-- rather than after somebody remembers to run something.
--
-- Kept in step with lib/pages/routes.ts by scripts/pages-check.ts, which fails
-- when the two disagree.
--
-- Admin and auth routes are deliberately absent: closing /admin closes the page
-- that reopens it, and closing /sign-in means nobody can sign in to reopen
-- anything. See ALWAYS_OPEN in lib/pages/routes.ts.
INSERT INTO "pages" ("route_key", "is_enabled", "show_in_nav") VALUES
  ('/',             true, true),
  ('/lessons',      true, true),
  ('/quiz',         true, true),
  ('/quiz/results', true, false),
  ('/chemical',     true, false),
  ('/experiments',  true, true),
  ('/games',        true, true)
ON CONFLICT ("route_key") DO NOTHING;
