/**
 * Stub for the `server-only` package in unit tests.
 *
 * `server-only` throws on import outside a React Server Component, which is
 * exactly the protection we want in the build — an accidental client import of
 * `lib/env.server.ts` or `db/client.ts` becomes a build error rather than a
 * leaked credential. It also makes those modules unimportable from jsdom
 * tests, so the unit project aliases it here.
 *
 * The real guard still applies to `pnpm build`; only the test runner sees this.
 */
export {};
