import { Badge } from "@/components/ui/badge";
import type { TranslationState } from "@/lib/translations/state";

/**
 * One word for how translated a row is.
 *
 * A badge with a variant rather than a coloured dot, for the same reason the
 * status column is: colour alone is not a label, and "out of date" has to be
 * readable by somebody who cannot tell two greens apart.
 *
 * `outline` for `missing` rather than `destructive`: an untranslated lesson is
 * a normal state of the work, not an error. `secondary` carries the two that
 * mean somebody is mid-task, and `destructive` is reserved for `stale` —
 * the one state where readers are being served something the source has moved
 * on from, which is the only one where doing nothing has a cost.
 */
const VARIANT: Record<
  TranslationState,
  "default" | "secondary" | "outline" | "destructive"
> = {
  published: "default",
  stale: "destructive",
  in_review: "secondary",
  draft: "secondary",
  missing: "outline",
};

export function TranslationBadge({
  state,
  label,
}: {
  state: TranslationState;
  /** Already translated into the admin's own locale by the caller. */
  label: string;
}) {
  return <Badge variant={VARIANT[state]}>{label}</Badge>;
}
