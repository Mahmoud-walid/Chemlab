import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
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
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
