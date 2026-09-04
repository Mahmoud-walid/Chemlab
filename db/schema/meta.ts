import { pgTable, text } from "drizzle-orm/pg-core";
import { id, timestamps } from "./_shared";

/**
 * The only table this foundation ships. It exists to prove the whole pipeline —
 * generate, review, commit, apply, query — before any real table depends on it.
 * Feature tables arrive with their own issues.
 */
export const schemaProbes = pgTable("schema_probes", {
  id: id(),
  note: text("note").notNull(),
  ...timestamps,
});

export type SchemaProbe = typeof schemaProbes.$inferSelect;
export type NewSchemaProbe = typeof schemaProbes.$inferInsert;
