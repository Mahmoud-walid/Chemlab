import { toNextJsHandler } from "better-auth/next-js";

import { getAuth } from "@/lib/auth";

/**
 * Better Auth's catch-all handler: sign-up, sign-in, sign-out, the OAuth
 * callback, and session reads all live under `/api/auth/*`.
 *
 * The Google callback URI is exactly `/api/auth/callback/google` — it must be
 * registered in the Google Cloud console verbatim, since Google accepts no
 * wildcards.
 *
 * `getAuth()` is called per request, not at module scope: the instance needs a
 * secret and a database, and neither exists during a `pnpm build` with no
 * environment.
 */
export async function GET(request: Request) {
  return toNextJsHandler(getAuth()).GET(request);
}

export async function POST(request: Request) {
  return toNextJsHandler(getAuth()).POST(request);
}
