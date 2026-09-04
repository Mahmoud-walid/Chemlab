import { notFound } from "next/navigation";
import Link from "next/link";
import elements from "@/data/periodic-table-detailed.json";
import { type Element } from "@/types/element";
import { getCategoryStyle, CATEGORY_LABELS } from "@/lib/element-utils";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// ── ISR: regenerate every 24h (data is static, but this is the pattern) ──
export const revalidate = 86400;

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
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const el = (elements as Element[]).find((e) => e.name.toLowerCase() === slug);
  if (!el) return {};
  return {
    title: `${el.name} (${el.symbol}) — Chemlab`,
    description: el.summary,
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
        className={cn(
          "text-sm text-right text-foreground",
          mono && "font-mono",
        )}
      >
        {String(value)}
      </span>
    </div>
  );
}

// ── Electron shell diagram (SVG) ──
function ElectronShellDiagram({ shells }: { shells: number[] }) {
  const cx = 80;
  const cy = 80;
  const nucleusR = 12;
  const shellGap = 16;

  return (
    <svg
      viewBox="0 0 160 160"
      className="w-32 h-32 sm:w-40 sm:h-40"
      aria-label="Electron shell diagram"
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
      >
        {shells.reduce((a, b) => a + b, 0)}e
      </text>
    </svg>
  );
}

// ── Page ──
export default async function ChemicalPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const el = (elements as Element[]).find((e) => e.name.toLowerCase() === slug);

  if (!el) notFound();

  const categoryStyle = getCategoryStyle(el.category);
  const categoryLabel = CATEGORY_LABELS[el.category] ?? el.category;

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
          ← Periodic Table
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
                {el.number}
              </span>
              <span
                className={cn(
                  "text-5xl sm:text-6xl font-bold leading-none",
                  categoryStyle.text,
                )}
              >
                {el.symbol}
              </span>
              <span className="text-xs text-muted-foreground mt-0.5">
                {el.atomic_mass.toFixed(3)}
              </span>
            </div>

            {/* Name + meta */}
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2 mb-2">
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

              <p className="text-sm text-muted-foreground leading-relaxed line-clamp-4">
                {el.summary}
              </p>

              <div className="mt-3 flex flex-wrap gap-3 text-sm">
                <span className="text-muted-foreground">
                  Phase:{" "}
                  <span className="text-foreground font-medium">
                    {el.phase}
                  </span>
                </span>
                {el.appearance && (
                  <span className="text-muted-foreground">
                    Appearance:{" "}
                    <span className="text-foreground font-medium">
                      {el.appearance}
                    </span>
                  </span>
                )}
              </div>
            </div>

            {/* Electron shell */}
            <div className="shrink-0 hidden sm:flex flex-col items-center gap-1">
              <ElectronShellDiagram shells={el.shells} />
              <span className="text-[10px] text-muted-foreground">
                {el.shells.join(", ")}
              </span>
            </div>
          </div>
        </div>

        {/* Detail cards grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6 animate-in fade-in slide-in-from-bottom-3 duration-300 delay-75">
          {/* Physical properties */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Physical Properties</CardTitle>
            </CardHeader>
            <CardContent>
              <Separator className="mb-2" />
              <Stat label="Atomic Mass" value={`${el.atomic_mass} u`} mono />
              <Stat
                label="Density"
                value={el.density != null ? `${el.density} g/cm³` : null}
                mono
              />
              <Stat
                label="Melting Point"
                value={el.melt != null ? `${el.melt} K` : null}
                mono
              />
              <Stat
                label="Boiling Point"
                value={el.boil != null ? `${el.boil} K` : null}
                mono
              />
              <Stat
                label="Molar Heat"
                value={
                  el.molar_heat != null ? `${el.molar_heat} J/(mol·K)` : null
                }
                mono
              />
              <Stat label="Period" value={el.period} />
              <Stat label="Phase" value={el.phase} />
            </CardContent>
          </Card>

          {/* Chemical properties */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Chemical Properties</CardTitle>
            </CardHeader>
            <CardContent>
              <Separator className="mb-2" />
              <Stat
                label="Electron Configuration"
                value={el.electron_configuration}
                mono
              />
              <Stat
                label="Semantic Config"
                value={el.electron_configuration_semantic}
                mono
              />
              <Stat label="Shells" value={el.shells.join(", ")} mono />
              <Stat
                label="Electron Affinity"
                value={
                  el.electron_affinity != null
                    ? `${el.electron_affinity} kJ/mol`
                    : null
                }
                mono
              />
              <Stat
                label="Electronegativity"
                value={el.electronegativity_pauling}
                mono
              />
            </CardContent>
          </Card>

          {/* Ionization energies */}
          {el.ionization_energies.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Ionization Energies</CardTitle>
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
                      IE{i + 1}: {energy} kJ/mol
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Discovery */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Discovery</CardTitle>
            </CardHeader>
            <CardContent>
              <Separator className="mb-2" />
              <Stat label="Discovered by" value={el.discovered_by} />
              <Stat label="Named by" value={el.named_by} />
              <Stat label="Color" value={el.color} />
              <div className="mt-3">
                <a
                  href={el.source}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-primary hover:underline"
                >
                  Wikipedia →
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
              <span className="text-xs text-muted-foreground mb-0.5">
                ← Previous
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
              <span className="text-xs text-muted-foreground mb-0.5">
                Next →
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
