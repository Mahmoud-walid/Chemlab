import { getTranslations, setRequestLocale } from "next-intl/server";

import { nextQuizPosition } from "@/db/queries/admin/quizzes";
import { requireAdminPermission } from "@/lib/admin/guard";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { QuizForm } from "../features/quiz-form";

export const dynamic = "force-dynamic";

export default async function NewQuizPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);

  await requireAdminPermission("quiz:create");

  const t = await getTranslations("admin.quizzes");
  const position = await nextQuizPosition();

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <Button variant="ghost" size="sm" asChild className="-ms-2">
          <Link href="/admin/quizzes">{t("backToList")}</Link>
        </Button>
        <h1 className="text-2xl font-bold tracking-tight">{t("newTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("newSubtitle")}</p>
      </div>

      <QuizForm
        values={{
          slug: "",
          title: "",
          description: "",
          difficulty: "easy",
          category: "",
          // At the end of the sequence, so creating a quiz never silently
          // reorders the catalogue.
          position,
          timeLimitMinutes: null,
          passMarkPercent: 60,
          maxAttempts: null,
          shuffleQuestions: false,
          shuffleOptions: false,
          isPublished: false,
        }}
      />
    </div>
  );
}
