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
export * from "./attempts";
export * from "./engagement";
export * from "./push";
export * from "./notifications";
export * from "./ci";
export * from "./comments";
export * from "./presence";
export * from "./auth";
export * from "./rbac";
export * from "./activity";
export * from "./settings";
export * from "./media";
