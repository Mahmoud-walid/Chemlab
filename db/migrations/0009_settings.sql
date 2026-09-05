CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	-- Nullable on purpose: a cleared optional setting (no contact address) is a
	-- null VALUE, which is different from having no row at all. The row's
	-- existence and its updated_at are what distinguish the two.
	"value" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
