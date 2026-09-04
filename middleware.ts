import createMiddleware from "next-intl/middleware";
import { routing } from "@/i18n/routing";

export default createMiddleware(routing);

export const config = {
  // Skip API routes, Next internals, and anything that looks like a file, so
  // static assets are never rewritten through the locale matcher.
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
