import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // ── Unused variables ───────────────────────────────────────────────────
  // Omitting a key by destructuring it out (`const { admin: _admin, ...rest }`)
  // is how this codebase keeps a payload from reaching the client — see
  // `app/[locale]/layout.tsx`, where dropping it would put the admin catalogue
  // into every public page. The inherited default reports those bindings as
  // unused, which trains the reader to skim the warning list; the deliberate
  // ones have to be silent for the genuine ones to be worth reading.
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          ignoreRestSiblings: true,
          varsIgnorePattern: "^_",
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },

  // ── i18n guards ────────────────────────────────────────────────────────
  // Locale-unaware navigation drops the locale on client-side transitions,
  // sending an Arabic reader back to English mid-session.
  {
    files: ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}"],
    ignores: ["components/ui/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "next/link",
              message:
                "Import { Link } from '@/i18n/routing' so the locale survives navigation.",
            },
            {
              name: "next/navigation",
              importNames: ["redirect", "usePathname", "useRouter"],
              message:
                "Import these from '@/i18n/routing' so the locale survives navigation.",
            },
          ],
        },
      ],
    },
  },

  // Bare text in JSX is an untranslated string. Element symbols, formulas and
  // punctuation are not language, so those are allowed through.
  {
    files: ["app/**/*.tsx", "components/customs/**/*.tsx"],
    rules: {
      "react/jsx-no-literals": [
        "error",
        {
          noStrings: true,
          // Props are checked separately below — checking them here would
          // flag every className.
          ignoreProps: true,
          allowedStrings: [
            "·",
            "—",
            "–",
            "•",
            "/",
            "%",
            ":",
            "×",
            "→",
            "←",
            "❤️",
          ],
        },
      ],
      // The user-visible attributes. A hard-coded aria-label is just as
      // untranslated as hard-coded body text, and easier to miss.
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "JSXAttribute[name.name=/^(aria-label|title|alt|placeholder|aria-description)$/] > Literal[value=/[A-Za-z]{3}/]",
          message:
            "User-facing attribute text must come from a message catalogue — use t('…').",
        },
      ],
    },
  },

  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
