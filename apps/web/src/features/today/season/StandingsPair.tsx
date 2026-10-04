import { AvatarStack } from "../../../ui/Avatar.tsx";
import type { StandingsPairModel } from "../today-view-model.ts";
import styles from "./cards.module.css";

const YOU = "Tú";

function gapText(difference: number): string {
  if (difference === 0) return "Van empatados";
  return `${difference} ${difference === 1 ? "pt" : "pts"} de diferencia`;
}

/** The viewer and the member next to them. Points only: no per-entry points (P3). */
export function StandingsPair({
  model,
  viewerName,
}: {
  readonly model: StandingsPairModel;
  readonly viewerName: string | null;
}) {
  const you = viewerName ?? YOU;
  if (model.kind === "solo") {
    return (
      <div className={styles.pair}>
        <AvatarStack names={[you]} />
        <div className={styles.pairText}>
          {YOU} {model.points} pts
        </div>
      </div>
    );
  }
  const otherLeads = model.otherPoints > model.viewerPoints;
  const line = otherLeads
    ? `${model.otherName} ${model.otherPoints} · ${YOU} ${model.viewerPoints}`
    : `${YOU} ${model.viewerPoints} · ${model.otherName} ${model.otherPoints}`;
  return (
    <div className={styles.pair}>
      <AvatarStack names={otherLeads ? [model.otherName, you] : [you, model.otherName]} />
      <div className={styles.pairBody}>
        <div className={styles.pairText}>{line}</div>
        <div className={styles.pairMeta}>
          Vas {model.rank}.º de {model.participantCount}
        </div>
      </div>
      <span className={styles.pairMeta}>{gapText(model.difference)}</span>
    </div>
  );
}
