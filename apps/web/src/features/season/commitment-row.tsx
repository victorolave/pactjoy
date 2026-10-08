import type { SeasonProgress } from "../../ports/wire.ts";
import { Badge } from "../../ui/Badge.tsx";
import { Icon } from "../../ui/icon/Icon.tsx";
import { HabitGlyph } from "../habits/index.ts";
import styles from "./CommitmentRow.module.css";

type StartedSeason = Extract<SeasonProgress, { state: "active" | "ended" }>;
export type SeasonCommitmentRowData = StartedSeason["own"]["commitments"][number];

export interface SeasonCommitmentRowProps {
  readonly row: SeasonCommitmentRowData;
  readonly onSelect?: ((commitmentId: string) => void) | undefined;
}

function formatSubtitle(row: SeasonCommitmentRowData): string {
  const isSpecificDays =
    row.measure.schedule.period === "perSession" &&
    row.measure.schedule.frequency.kind === "specificDays" &&
    row.opportunities.counted > 0;
  if (isSpecificDays) {
    const daysLabel = row.opportunities.counted === 1 ? "día previsto" : "días previstos";
    return `${row.weightPercent} % · ${row.opportunities.kept} de ${row.opportunities.counted} ${daysLabel}`;
  }
  if (row.consistency !== null) {
    return `${row.weightPercent} % · consistencia ${row.consistency} %`;
  }
  return `${row.weightPercent} %`;
}

export function SeasonCommitmentRow({ row, onSelect }: SeasonCommitmentRowProps) {
  const isPaused = row.pause === "paused" || row.pause === "onHold";
  const subtitle = formatSubtitle(row);

  return (
    <button
      type="button"
      className={styles.row}
      onClick={() => onSelect?.(row.commitmentId)}
      aria-label={`${row.habit.name}, ${row.points} de ${row.weightPercent * 10} puntos`}
    >
      <HabitGlyph icon={row.habit.icon} />

      <div className={styles.body}>
        <div className={styles.title}>{row.habit.name}</div>
        {isPaused ? (
          <div>
            <Badge tone="pending" icon="circle-pause">
              En pausa
            </Badge>
          </div>
        ) : (
          <div className={styles.subtitle}>{subtitle}</div>
        )}
      </div>

      <div className={styles.trailing}>
        <span className={styles.points}>
          {row.points} / {row.weightPercent * 10}
        </span>
        <span className={styles.chevron} aria-hidden="true">
          <Icon name="chevron-right" size={20} />
        </span>
      </div>
    </button>
  );
}
