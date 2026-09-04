import "server-only";

/**
 * Whether this process has a database to talk to.
 *
 * `pnpm build` must keep working with no database — CI builds on every pull
 * request and a build that needs a live Postgres is a build that fails when
 * the database is down. The routes that read content therefore ask this before
 * pre-rendering: with a database they enumerate their slugs and prerender
 * every page, without one they emit no static params and each page is rendered
 * on demand instead. Same code, same output, one fewer deployment dependency.
 *
 * `dynamicParams` stays at its default (true), so a slug that was not
 * prerendered is still served rather than 404ing.
 */
export function hasDatabase(): boolean {
  return Boolean(process.env.DATABASE_URL);
}
