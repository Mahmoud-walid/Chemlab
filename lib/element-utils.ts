export type CategoryKey =
  | "diatomic nonmetal"
  | "noble gas"
  | "alkali metal"
  | "alkaline earth metal"
  | "metalloid"
  | "polyatomic nonmetal"
  | "post-transition metal"
  | "transition metal"
  | "lanthanide"
  | "actinide"
  | "unknown, predicted to be an alkali metal"
  | "unknown, predicted to be a noble gas"
  | "unknown, predicted to be a transition metal"
  | "unknown, predicted to be a post-transition metal"
  | "unknown, probably a noble gas"
  | "unknown, probably post-transition metal"
  | "unknown, predicted to be metalloid";

// Tailwind bg classes mapped to category — all use your theme tokens via opacity modifiers
export const CATEGORY_STYLES: Record<
  string,
  { bg: string; text: string; border: string }
> = {
  "diatomic nonmetal": {
    bg: "bg-chart-3/20",
    text: "text-chart-3-on-tint",
    border: "border-chart-3/40",
  },
  "noble gas": {
    bg: "bg-chart-4/20",
    text: "text-chart-4-on-tint",
    border: "border-chart-4/40",
  },
  "alkali metal": {
    bg: "bg-chart-1/20",
    text: "text-chart-1-on-tint",
    border: "border-chart-1/40",
  },
  "alkaline earth metal": {
    bg: "bg-chart-2/20",
    text: "text-chart-2-on-tint",
    border: "border-chart-2/40",
  },
  metalloid: {
    bg: "bg-chart-5/20",
    text: "text-chart-5-on-tint",
    border: "border-chart-5/40",
  },
  "polyatomic nonmetal": {
    bg: "bg-chart-3/15",
    text: "text-chart-3-on-tint",
    border: "border-chart-3/30",
  },
  "post-transition metal": {
    bg: "bg-primary/15",
    text: "text-primary-text",
    border: "border-primary/30",
  },
  "transition metal": {
    bg: "bg-accent",
    text: "text-accent-foreground",
    border: "border-accent-foreground/20",
  },
  lanthanide: {
    bg: "bg-secondary",
    text: "text-secondary-foreground",
    border: "border-secondary-foreground/20",
  },
  actinide: {
    bg: "bg-muted",
    text: "text-muted-foreground",
    border: "border-border",
  },
};

export function getCategoryStyle(category: string) {
  return (
    CATEGORY_STYLES[category.toLowerCase()] ?? {
      bg: "bg-muted",
      text: "text-muted-foreground",
      border: "border-border",
    }
  );
}

export const CATEGORY_LABELS: Record<string, string> = {
  "diatomic nonmetal": "Diatomic Nonmetal",
  "noble gas": "Noble Gas",
  "alkali metal": "Alkali Metal",
  "alkaline earth metal": "Alkaline Earth Metal",
  metalloid: "Metalloid",
  "polyatomic nonmetal": "Polyatomic Nonmetal",
  "post-transition metal": "Post-Transition Metal",
  "transition metal": "Transition Metal",
  lanthanide: "Lanthanide",
  actinide: "Actinide",
};
