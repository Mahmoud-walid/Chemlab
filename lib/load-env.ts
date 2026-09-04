/**
 * Loads `.env` / `.env.local` for code that runs OUTSIDE the Next.js runtime —
 * the `scripts/` entry points — and, via `next.config.ts`, for Next itself.
 *
 * Precedence differs from stock dotenv on purpose:
 *
 *   `.env`        never overrides a variable already in the environment
 *   `.env.local`  DOES override it
 *
 * Next.js and dotenv both let a pre-set variable win, which is right on a
 * server where the platform injects configuration. It is wrong on a developer
 * machine or a hosted dev container, where the shell may already carry a
 * `DATABASE_URL` pointing somewhere else entirely and the file you just edited
 * silently does nothing. `.env.local` is git-ignored and never shipped, so its
 * presence is always a deliberate local choice — deferring to it cannot affect
 * a real deployment, which has no such file.
 *
 * Import it for its side effect, before anything reads `process.env`:
 *
 *   import "@/lib/load-env";
 */
import { config } from "dotenv";

config({ path: ".env", quiet: true });
config({ path: ".env.local", override: true, quiet: true });
