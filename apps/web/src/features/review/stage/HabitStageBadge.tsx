import type { HabitStageDto } from "../../../ports/wire.ts";
import { Badge, type BadgeTone } from "../../../ui/Badge.tsx";
import { useCommitmentStage } from "../queries.ts";

const STAGES: Readonly<Record<HabitStageDto, { label: string; tone: BadgeTone }>> = {
  new: { label: "🌱 Nuevo", tone: "neutral" },
  developing: { label: "🌿 En desarrollo", tone: "neutral" },
  integrated: { label: "🌳 Integrado", tone: "success" },
  graduated: { label: "🎓 Graduado", tone: "info" },
};

/** The stage as a badge, for screens that already know it (the season results, 37). */
export function HabitStageTag({ stage }: { readonly stage: HabitStageDto }) {
  const { label, tone } = STAGES[stage];
  return <Badge tone={tone}>{label}</Badge>;
}

export interface HabitStageBadgeProps {
  readonly seasonId: string;
  readonly commitmentId: string;
}

/**
 * The derived maturity of one of the VIEWER's commitments (design 24a, 24b, 37). Only ever mounted
 * for the owner: a peer's stage is a 404 on the server and never requested. The badge is
 * optional, so it shows nothing while loading and nothing when the read fails.
 */
export function HabitStageBadge({ seasonId, commitmentId }: HabitStageBadgeProps) {
  const stage = useCommitmentStage(seasonId, commitmentId, true);
  if (stage.data === undefined) return null;
  return <HabitStageTag stage={stage.data.stage} />;
}
