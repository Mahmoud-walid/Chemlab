import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";

import {
  authConfigured,
  getServerEnv,
  googleConfigured,
} from "@/lib/env.server";
import { safeRedirect } from "@/lib/safe-redirect";
import type { Locale } from "@/i18n/routing";
import { AuthForm } from "../features/auth-form";

// Reads configuration and a session, so there is nothing to prerender.
export const dynamic = "force-dynamic";

export default async function SignUpPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ next?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);

  const env = getServerEnv();
  // Without a secret there is no sign-in to offer. A 404 is honest; a form
  // that always fails is not.
  if (!authConfigured(env)) notFound();

  const { next } = await searchParams;

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4 py-10">
      <AuthForm
        mode="sign-up"
        // Validated here, on the server, before it is ever handed to the
        // client: this value came from the query string.
        next={safeRedirect(next)}
        googleEnabled={googleConfigured(env)}
      />
    </div>
  );
}
