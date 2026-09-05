import { createNavigation } from "next-intl/navigation";
import { routing } from "@/i18n/routing";

/**
 * Locale-aware navigation. Import these instead of `next/link` and
 * `next/navigation` — the plain versions drop the locale on client-side
 * transitions, sending an Arabic reader back to English mid-session. An ESLint
 * rule enforces this in `app/**` and `components/**`.
 */
export const {
  Link,
  redirect,
  permanentRedirect,
  usePathname,
  useRouter,
  getPathname,
} = createNavigation(routing);
