/**
 * Barrel for the whole schema.
 *
 * Load-bearing, not decoration: Drizzle's relational query API needs the full
 * schema object, so every schema file must be re-exported here or its relations
 * are invisible to `db.query`.
 */
export * from "./_shared";
export * from "./meta";
export * from "./content";
export * from "./auth";
