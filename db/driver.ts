/**
 * Which Postgres driver to use for a given connection string.
 *
 * Two are supported, and the URL decides:
 *
 * - **Neon** (`*.neon.tech`) → `@neondatabase/serverless`. Serverless functions
 *   get no long-lived process, so a TCP pool either leaks connections across
 *   invocations or pays a fresh handshake per request. Neon's driver speaks
 *   HTTP/WebSocket to Neon's own pooler and is built for that lifecycle.
 * - **Anything else** → `node-postgres`. A local Postgres, a container, or a
 *   managed instance speaks the normal wire protocol and cannot answer the
 *   Neon driver's HTTP endpoint at all.
 *
 * Deliberately not a `NODE_ENV` check: the same environment might point at
 * either, and the connection string is the thing that actually knows.
 */
export type DriverKind = "neon" | "node-postgres";

export function driverFor(connectionString: string): DriverKind {
  try {
    const { hostname } = new URL(connectionString);
    return hostname.endsWith(".neon.tech") ? "neon" : "node-postgres";
  } catch {
    // An unparseable URL is not this function's problem to report — the env
    // schema rejects it with a much better message.
    return "node-postgres";
  }
}

/** True for hosts that terminate TLS themselves; local Postgres does not. */
export function requiresSsl(connectionString: string): boolean {
  return driverFor(connectionString) === "neon";
}
