import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import quizzes from "../data/quiz.json";

/**
 * Proves the answer key is not in the JavaScript the browser downloads.
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
  for (const file of files) {
    const contents = await readFile(file, "utf8");
    for (const needle of needles) {
      if (contents.includes(needle))
        found.push(`${file}: ${needle.slice(0, 60)}…`);
    }
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
    `bundle: ${files.length} client chunks, no answer key (${needles.length} probes)`,
  );
}

void main();
