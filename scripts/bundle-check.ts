// Before anything reads `process.env`: the secret probes below can only look
// for values this process can see, and without the env file a check that
// searches for nothing passes for the wrong reason.
import "@/lib/load-env";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import quizzes from "../data/quiz.json";

/**
 * Proves that two secrets are not in the JavaScript the browser downloads:
 * the quiz answer key, and every server-only credential.
 *
 * This is the regression guard for the exact defect the exam engine replaced:
 * `app/quiz/[slug]/page.tsx` was a `"use client"` component doing
 * `import quizData from "@/data/quiz.json"`, so every answer and every
 * explanation for all six quizzes was in the bundle before a candidate
 * answered anything. Anyone could read it from devtools.
 *
 * Greps the built client chunks for the seeded explanations. Explanations
 * rather than answers because an answer is a short string — "Au" — that
 * legitimately appears in element data and in minified code, while an
 * explanation sentence appears in exactly one place if it appears at all.
 *
 * The second check is cheaper to describe and just as important. A stray
 * `import "@/lib/env.server"` from a client component, or a `NEXT_PUBLIC_`
 * prefix typed onto the wrong variable, puts a secret in a file served to
 * every visitor — and nothing else in the toolchain says so. `VAPID_PRIVATE_KEY`
 * is the sharpest example: a copy of it lets anybody send notifications that
 * appear to come from this site.
 *
 * Runs after `pnpm build`, in CI's build job. It cannot run in the unit
 * project: there is nothing to grep until something is built.
 */

interface SeedQuestion {
  question: string;
  answer: string;
  explanation: string;
}

interface SeedQuiz {
  slug: string;
  questions: SeedQuestion[];
}

const CLIENT_CHUNKS = ".next/static";

async function jsFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await jsFiles(path)));
    else if (entry.name.endsWith(".js")) out.push(path);
  }
  return out;
}

async function main() {
  let files: string[];
  try {
    files = await jsFiles(CLIENT_CHUNKS);
  } catch {
    console.error(
      `No ${CLIENT_CHUNKS} directory. Run \`pnpm build\` before \`pnpm bundle:check\`.`,
    );
    process.exit(1);
  }

  // A handful rather than all sixty: this checks whether the file was bundled
  // at all, and one leaked explanation means the whole file leaked.
  const needles = (quizzes as SeedQuiz[])
    .flatMap((quiz) => quiz.questions.slice(0, 2))
    .map((question) => question.explanation)
    .filter((explanation) => explanation.length > 20);

  const found: string[] = [];
  const leakedSecrets: string[] = [];

  for (const file of files) {
    const contents = await readFile(file, "utf8");
    for (const needle of needles) {
      if (contents.includes(needle))
        found.push(`${file}: ${needle.slice(0, 60)}…`);
    }
    for (const [name, value] of secrets()) {
      // The VALUE, never the name: a variable name legitimately appears in
      // server code that happens to be in a shared chunk, and matching on it
      // would fail the build for a comment.
      if (contents.includes(value)) leakedSecrets.push(`${file}: ${name}`);
    }
  }

  if (leakedSecrets.length > 0) {
    console.error("\nA server-only secret is in the client bundle:\n");
    for (const hit of leakedSecrets) console.error(`  ${hit}`);
    console.error(
      "\nSomething imported a server-only module from a client component, " +
        "or a secret gained a NEXT_PUBLIC_ prefix. The value is now public: " +
        "rotate it, then find the import.",
    );
    process.exit(1);
  }

  if (found.length > 0) {
    console.error(
      "\nThe answer key is in the client bundle. A candidate can read it:\n",
    );
    for (const hit of found) console.error(`  ${hit}`);
    console.error(
      "\nSomething imported data/quiz.json, or a server component passed " +
        "explanations to a client one. The in-progress paper must carry " +
        "neither `explanation` nor `is_correct` — see db/queries/exams/attempts.ts.",
    );
    process.exit(1);
  }

  console.log(
    `bundle: ${files.length} client chunks, no answer key ` +
      `(${needles.length} probes), no server secrets (${secrets().length} probes)`,
  );
}

/**
 * The server-only values worth grepping for, and only those that are actually
 * set: an unset secret has no value to leak, and searching for an empty string
 * would match every file.
 *
 * Short values are skipped too. A three-character secret would match by
 * coincidence somewhere in a megabyte of minified JavaScript, and a build that
 * fails at random is a build people learn to ignore.
 */
function secrets(): [string, string][] {
  const names = [
    "VAPID_PRIVATE_KEY",
    "BETTER_AUTH_SECRET",
    "GOOGLE_CLIENT_SECRET",
    "DATABASE_URL",
    "DATABASE_URL_UNPOOLED",
    // The CI alert secrets. The Slack URL is included because the URL IS the
    // credential: anyone holding it can post to the channel.
    "CI_NOTIFY_SECRET",
    "SLACK_WEBHOOK_URL",
    // Signs every upload this server authorises. A copy of it is the ability
    // to write anything into the media account.
    "CLOUDINARY_API_SECRET",
  ];

  return names
    .map((name) => [name, process.env[name] ?? ""] as [string, string])
    .filter(([, value]) => value.length >= 16);
}

void main();
