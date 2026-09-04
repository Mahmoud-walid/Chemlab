import { notFound } from "next/navigation";
import {
  getFormatter,
  getTranslations,
  setRequestLocale,
} from "next-intl/server";
import { ArrowLeft, ArrowRight } from "lucide-react";
import elements from "@/data/periodic-table-detailed.json";
import { type Element } from "@/types/element";
import { Link } from "@/i18n/navigation";
import { defaultLocale, isRtl, type Locale } from "@/i18n/routing";
import { getCategoryStyle } from "@/lib/element-utils";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// ── ISR: regenerate every 24h (data is static, but this is the pattern) ──
export const revalidate = 86400;

/**
 * Latin (Western Arabic) digits on every locale — a page carrying `H₂O`,
 * `1.008` and equation coefficients reads badly with Eastern Arabic numerals,
 * so the numbering system is pinned instead of following `ar`'s default.
 */
const LATIN_DIGITS = { numberingSystem: "latn" } as const;

/**
 * Maps a raw category string ("post-transition metal") to its message key
 * under `element.categories.*` ("postTransitionMetal"). Kept local rather than
 * imported from the client `element-cell` module so this server component does
 * not pull in a client boundary.
 */
function categoryMessageKey(category: string): string {
  return category
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((word, i) => (i === 0 ? word : word[0].toUpperCase() + word.slice(1)))
    .join("");
}

function findElement(slug: string) {
  return (elements as Element[]).find((e) => e.name.toLowerCase() === slug);
}

// ── Pre-generate all 118 element pages at build time ──
export async function generateStaticParams() {
  return (elements as Element[]).map((el) => ({
    slug: el.name.toLowerCase(),
  }));
}

// ── SEO metadata ──
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  const el = findElement(slug);
  if (!el) return {};

  const t = await getTranslations({
    locale: locale as Locale,
    namespace: "element",
  });
  const tCommon = await getTranslations({
    locale: locale as Locale,
    namespace: "common",
  });
  const format = await getFormatter({ locale: locale as Locale });

  // Runtime-derived key; next-intl types keys as a literal union.
  const categoryKey = `categories.${categoryMessageKey(
    el.category,
  )}` as Parameters<typeof t>[0];

  return {
    title: t("metaTitle", {
      name: el.name,
      symbol: el.symbol,
      appName: tCommon("appName"),
    }),
    description: t("metaDescription", {
      name: el.name,
      symbol: el.symbol,
      number: format.number(el.number, { numberingSystem: "latn" }),
      category: t.has(categoryKey) ? t(categoryKey) : el.category,
    }),
  };
}

// ── Stat row helper ──
function Stat({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string | number | null | undefined;
  mono?: boolean;
}) {
  if (value === null || value === undefined) return null;
  return (
    <div className="flex justify-between gap-4 py-1.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span
        className={cn("text-sm text-end text-foreground", mono && "font-mono")}
        // Measurements are numeric runs (`1.008 u`, `g/cm³`): keep them LTR so
        // the bidi algorithm does not reorder value and unit under `dir=rtl`.
        {...(mono ? { dir: "ltr" as const } : {})}
      >
        {String(value)}
      </span>
    </div>
  );
}

// ── Electron shell diagram (SVG) ──
function ElectronShellDiagram({
  shells,
  label,
  total,
}: {
  shells: number[];
  label: string;
  total: string;
}) {
  const cx = 80;
  const cy = 80;
  const nucleusR = 12;
  const shellGap = 16;

  return (
    <svg
      viewBox="0 0 160 160"
      className="w-32 h-32 sm:w-40 sm:h-40"
      role="img"
      aria-label={label}
    >
      {/* Shells */}
      {shells.map((count, i) => {
        const r = nucleusR + (i + 1) * shellGap;
        const electrons = Array.from({ length: count });
        return (
          <g key={i}>
            <circle
              cx={cx}
              cy={cy}
              r={r}
              fill="none"
              stroke="currentColor"
              strokeOpacity={0.2}
              strokeWidth={1}
            />
            {electrons.map((_, j) => {
              const angle = (2 * Math.PI * j) / count - Math.PI / 2;
              const ex = cx + r * Math.cos(angle);
              const ey = cy + r * Math.sin(angle);
              return (
                <circle
                  key={j}
                  cx={ex}
                  cy={ey}
                  r={2.5}
                  className="fill-primary"
                />
              );
            })}
          </g>
        );
      })}
      {/* Nucleus */}
      <circle cx={cx} cy={cy} r={nucleusR} className="fill-primary/30" />
      <text
        x={cx}
        y={cy}
        textAnchor="middle"
        dominantBaseline="central"
        className="fill-primary text-[9px] font-bold"
        fontSize={9}
        direction="ltr"
      >
        {total}
      </text>
    </svg>
  );
}

// ── Page ──
export default async function ChemicalPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  setRequestLocale(locale as Locale);

  const el = findElement(slug);
  if (!el) notFound();

  const t = await getTranslations("element");
  const tCommon = await getTranslations("common");
  const format = await getFormatter();
  const rtl = isRtl(locale);
  const BackIcon = rtl ? ArrowRight : ArrowLeft;
  const ForwardIcon = rtl ? ArrowLeft : ArrowRight;

  const categoryStyle = getCategoryStyle(el.category);
  // Category and phase both come from JSON data, so their message keys are only
  // known at runtime; next-intl types keys as a literal union.
  const categoryKey = `categories.${categoryMessageKey(
    el.category,
  )}` as Parameters<typeof t>[0];
  const categoryLabel = t.has(categoryKey) ? t(categoryKey) : el.category;
  const phaseKey = `phases.${el.phase.toLowerCase()}` as Parameters<
    typeof t
  >[0];
  const phaseLabel = t.has(phaseKey) ? t(phaseKey) : el.phase;

  const num = (value: number) => format.number(value, LATIN_DIGITS);
  const shellList = el.shells.map((s) => num(s)).join(", ");

  // Previous / next navigation
  const prev = (elements as Element[]).find((e) => e.number === el.number - 1);
  const next = (elements as Element[]).find((e) => e.number === el.number + 1);

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:px-8">
        {/* Back */}
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6"
        >
          <BackIcon className="w-4 h-4" aria-hidden />
          {t("backToTable")}
        </Link>

        {/* Hero card */}
        <div
          className={cn(
            "rounded-2xl border p-6 sm:p-8 mb-6",
            "animate-in fade-in slide-in-from-bottom-2 duration-300",
            categoryStyle.bg,
            categoryStyle.border,
          )}
        >
          <div className="flex flex-col sm:flex-row sm:items-start gap-6">
            {/* Symbol block */}
            <div
              className={cn(
                "flex flex-col items-center justify-center rounded-xl border",
                "w-28 h-28 sm:w-32 sm:h-32 shrink-0",
                "bg-background/60 backdrop-blur-sm",
                categoryStyle.border,
              )}
            >
              <span className="text-[11px] text-muted-foreground font-mono">
                {num(el.number)}
              </span>
              {/* Symbols are locale-invariant */}
              <span
                className={cn(
                  "text-5xl sm:text-6xl font-bold leading-none",
                  categoryStyle.text,
                )}
              >
                {el.symbol}
              </span>
              <span className="text-xs text-muted-foreground mt-0.5">
                {format.number(el.atomic_mass, {
                  ...LATIN_DIGITS,
                  minimumFractionDigits: 3,
                  maximumFractionDigits: 3,
                })}
              </span>
            </div>

            {/* Name + meta */}
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2 mb-2">
                {/* Element names come straight from the data (out of scope) */}
                <h1 className="text-3xl sm:text-4xl font-bold text-foreground">
                  {el.name}
                </h1>
                <Badge
                  variant="outline"
                  className={cn(
                    "text-xs",
                    categoryStyle.text,
                    categoryStyle.border,
                    categoryStyle.bg,
                  )}
                >
                  {categoryLabel}
                </Badge>
              </div>

              {/*
                `summary` is English encyclopaedia prose from the dataset. It is
                shown as-is on every locale, with a notice on Arabic explaining
                why it is not translated.
              */}
              <p
                className="text-sm text-muted-foreground leading-relaxed line-clamp-4"
                lang="en"
                dir="ltr"
              >
                {el.summary}
              </p>

              <div className="mt-3 flex flex-wrap gap-3 text-sm">
                <span className="text-muted-foreground">
                  {t("phase")}:{" "}
                  <span className="text-foreground font-medium">
                    {phaseLabel}
                  </span>
                </span>
                {el.appearance && (
                  <span className="text-muted-foreground">
                    {t("appearance")}:{" "}
                    <span
                      className="text-foreground font-medium"
                      lang="en"
                      dir="ltr"
                    >
                      {el.appearance}
                    </span>
                  </span>
                )}
              </div>
            </div>

            {/* Electron shell */}
            <div className="shrink-0 hidden sm:flex flex-col items-center gap-1">
              <ElectronShellDiagram
                shells={el.shells}
                label={t("electronShellDiagram", { name: el.name })}
                total={t("electronCount", {
                  count: num(el.shells.reduce((a, b) => a + b, 0)),
                })}
              />
              <span className="text-[10px] text-muted-foreground" dir="ltr">
                {shellList}
              </span>
            </div>
          </div>
        </div>

        {/*
          The dataset's `summary`, `appearance`, discoverer and colour fields
          are English source text. Every non-default locale gets a notice
          saying so rather than a silent language switch mid-page.
        */}
        {locale !== defaultLocale && (
          <UntranslatedNotice locale={locale} className="mb-6" />
        )}

        {/* Detail cards grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6 animate-in fade-in slide-in-from-bottom-3 duration-300 delay-75">
          {/* Physical properties */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                {t("sections.physical")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Separator className="mb-2" />
              <Stat
                label={t("atomicMass")}
                value={t("units.atomicMass", { value: num(el.atomic_mass) })}
                mono
              />
              <Stat
                label={t("density")}
                value={
                  el.density != null
                    ? t("units.density", { value: num(el.density) })
                    : null
                }
                mono
              />
              <Stat
                label={t("melt")}
                value={
                  el.melt != null
                    ? t("units.kelvin", { value: num(el.melt) })
                    : null
                }
                mono
              />
              <Stat
                label={t("boil")}
                value={
                  el.boil != null
                    ? t("units.kelvin", { value: num(el.boil) })
                    : null
                }
                mono
              />
              <Stat
                label={t("molarHeat")}
                value={
                  el.molar_heat != null
                    ? t("units.molarHeat", { value: num(el.molar_heat) })
                    : null
                }
                mono
              />
              <Stat label={t("period")} value={num(el.period)} />
              <Stat label={t("phase")} value={phaseLabel} />
            </CardContent>
          </Card>

          {/* Chemical properties */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                {t("sections.chemical")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Separator className="mb-2" />
              <Stat
                label={t("electronConfiguration")}
                value={el.electron_configuration}
                mono
              />
              <Stat
                label={t("electronConfigurationSemantic")}
                value={el.electron_configuration_semantic}
                mono
              />
              <Stat label={t("shells")} value={shellList} mono />
              <Stat
                label={t("electronAffinity")}
                value={
                  el.electron_affinity != null
                    ? t("units.kilojoulesPerMole", {
                        value: num(el.electron_affinity),
                      })
                    : null
                }
                mono
              />
              <Stat
                label={t("electronegativity")}
                value={
                  el.electronegativity_pauling != null
                    ? num(el.electronegativity_pauling)
                    : null
                }
                mono
              />
            </CardContent>
          </Card>

          {/* Ionization energies */}
          {el.ionization_energies.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">
                  {t("sections.ionization")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Separator className="mb-2" />
                <div className="flex flex-wrap gap-1.5">
                  {el.ionization_energies.map((energy, i) => (
                    <Badge
                      key={i}
                      variant="secondary"
                      className="font-mono text-xs"
                    >
                      {t("ionizationEnergy", { index: num(i + 1) })}
                      {": "}
                      <span dir="ltr">
                        {t("units.kilojoulesPerMole", { value: num(energy) })}
                      </span>
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Discovery */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                {t("sections.discovery")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Separator className="mb-2" />
              {/* Personal and colour names come from the dataset in English. */}
              <Stat label={t("discoveredBy")} value={el.discovered_by} />
              <Stat label={t("namedBy")} value={el.named_by} />
              <Stat label={t("color")} value={el.color} />
              <div className="mt-3">
                <a
                  href={el.source}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                >
                  {t("wikipedia")}
                  <ForwardIcon className="w-3.5 h-3.5" aria-hidden />
                </a>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Prev / Next navigation */}
        <div className="flex justify-between gap-4 animate-in fade-in slide-in-from-bottom-4 duration-300 delay-100">
          {prev ? (
            <Link
              href={`/chemical/${prev.name.toLowerCase()}`}
              className="flex-1 flex flex-col items-start p-3 rounded-xl border border-border hover:bg-accent transition-colors"
            >
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground mb-0.5">
                <BackIcon className="w-3.5 h-3.5" aria-hidden />
                {tCommon("previous")}
              </span>
              <span className="text-sm font-semibold">
                {prev.symbol} · {prev.name}
              </span>
            </Link>
          ) : (
            <div className="flex-1" />
          )}

          {next ? (
            <Link
              href={`/chemical/${next.name.toLowerCase()}`}
              className="flex-1 flex flex-col items-end p-3 rounded-xl border border-border hover:bg-accent transition-colors"
            >
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground mb-0.5">
                {tCommon("next")}
                <ForwardIcon className="w-3.5 h-3.5" aria-hidden />
              </span>
              <span className="text-sm font-semibold">
                {next.symbol} · {next.name}
              </span>
            </Link>
          ) : (
            <div className="flex-1" />
          )}
        </div>
      </div>
    </div>
  );
}

// ── "English source text" notice, shown on non-English locales ──
async function UntranslatedNotice({
  locale,
  className,
}: {
  locale: string;
  className?: string;
}) {
  const t = await getTranslations({
    locale: locale as Locale,
    namespace: "translation",
  });
  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-muted/40 p-3 text-sm",
        className,
      )}
    >
      <p className="font-medium text-foreground">{t("notAvailableTitle")}</p>
      <p className="text-muted-foreground">{t("notAvailableBody")}</p>
    </div>
  );
}
