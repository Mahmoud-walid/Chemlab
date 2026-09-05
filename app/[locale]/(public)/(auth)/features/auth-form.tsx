"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { toast } from "@/components/ui/sonner";

import { Link, useRouter } from "@/i18n/navigation";
import { authClient } from "@/lib/auth-client";
import {
  signInSchema,
  signUpSchema,
  type SignInInput,
  type SignUpInput,
} from "@/lib/auth-schemas";
import { safeRedirect } from "@/lib/safe-redirect";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";

/**
 * One component for both forms.
 *
 * They differ by one field and three strings; two near-identical files would
 * drift, and it is the drift — an error message that reveals on one page what
 * the other carefully hides — that turns a form into an enumeration oracle.
 *
 * The zod schemas are the SAME modules the server validates with. This form
 * exists to give fast feedback, never to be the check that matters.
 */

type Mode = "sign-in" | "sign-up";

export function AuthForm({
  mode,
  next,
  googleEnabled,
}: {
  mode: Mode;
  next: string;
  googleEnabled: boolean;
}) {
  const t = useTranslations("auth");
  const router = useRouter();
  const [pending, setPending] = useState(false);

  const isSignUp = mode === "sign-up";
  // Validated again here, not just where it was parsed: this value ends up in
  // a client-side navigation, and an open redirect is an open redirect
  // whichever layer performs it.
  const destination = safeRedirect(next);

  const form = useForm<SignInInput & Partial<SignUpInput>>({
    resolver: zodResolver(isSignUp ? signUpSchema : signInSchema),
    defaultValues: { email: "", password: "", ...(isSignUp && { name: "" }) },
  });

  async function onSubmit(values: SignInInput & Partial<SignUpInput>) {
    setPending(true);
    try {
      const result = isSignUp
        ? await authClient.signUp.email({
            name: values.name!,
            email: values.email,
            password: values.password,
            callbackURL: destination,
          })
        : await authClient.signIn.email({
            email: values.email,
            password: values.password,
            callbackURL: destination,
          });

      if (result.error) {
        // One message for every failure mode. "No such account" and "wrong
        // password" must be indistinguishable, and a lockout must not announce
        // that the address exists either.
        toast.error({
          title:
            result.error.status === 429
              ? t("tooManyAttempts")
              : isSignUp
                ? t("signUpFailed")
                : t("signInFailed"),
          description: "",
        });
        return;
      }

      router.push(destination);
      router.refresh();
    } catch {
      toast.error({
        title: isSignUp ? t("signUpFailed") : t("signInFailed"),
        description: "",
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="w-full max-w-sm space-y-6">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-bold tracking-tight">
          {isSignUp ? t("signUpTitle") : t("signInTitle")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {isSignUp ? t("signUpSubtitle") : t("signInSubtitle")}
        </p>
      </div>

      {googleEnabled && (
        <>
          <Button
            type="button"
            variant="outline"
            className="w-full"
            disabled={pending}
            onClick={() =>
              authClient.signIn.social({
                provider: "google",
                callbackURL: destination,
              })
            }
          >
            {t("continueWithGoogle")}
          </Button>
          <div className="flex items-center gap-3">
            <Separator className="flex-1" />
            <span className="text-xs uppercase tracking-wider text-muted-foreground">
              {t("or")}
            </span>
            <Separator className="flex-1" />
          </div>
        </>
      )}

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          {isSignUp && (
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("name")}</FormLabel>
                  <FormControl>
                    <Input
                      autoComplete="name"
                      placeholder={t("namePlaceholder")}
                      {...field}
                      value={field.value ?? ""}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}

          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("email")}</FormLabel>
                <FormControl>
                  <Input
                    type="email"
                    autoComplete="email"
                    placeholder={t("emailPlaceholder")}
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("password")}</FormLabel>
                <FormControl>
                  <Input
                    type="password"
                    autoComplete={
                      isSignUp ? "new-password" : "current-password"
                    }
                    {...field}
                  />
                </FormControl>
                {isSignUp && (
                  <FormDescription>{t("passwordHint")}</FormDescription>
                )}
                <FormMessage />
              </FormItem>
            )}
          />

          <Button type="submit" className="w-full" disabled={pending}>
            {pending
              ? isSignUp
                ? t("submittingSignUp")
                : t("submittingSignIn")
              : isSignUp
                ? t("signUp")
                : t("signIn")}
          </Button>
        </form>
      </Form>

      <p className="text-sm text-muted-foreground">
        {isSignUp ? t("haveAccount") : t("noAccount")}{" "}
        <Link
          href={{
            pathname: isSignUp ? "/sign-in" : "/sign-up",
            query: { next: destination },
          }}
          className="font-medium text-primary-text underline underline-offset-4"
        >
          {isSignUp ? t("signIn") : t("signUp")}
        </Link>
      </p>
    </div>
  );
}
