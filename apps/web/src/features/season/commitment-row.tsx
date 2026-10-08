import type { SeasonProgress } from "../../ports/wire.ts";
import { Badge } from "../../ui/Badge.tsx";
import { Icon, type IconName } from "../../ui/icon/Icon.tsx";
import styles from "./CommitmentRow.module.css";

type StartedSeason = Extract<SeasonProgress, { state: "active" | "ended" }>;
export type SeasonCommitmentRowData = StartedSeason["own"]["commitments"][number];

export interface SeasonCommitmentRowProps {
  readonly row: SeasonCommitmentRowData;
  readonly onSelect?: ((commitmentId: string) => void) | undefined;
}

type HabitTint = "orange" | "pink" | "purple" | "coral" | "cream" | "neutral";

const TINTS: Readonly<Record<string, HabitTint>> = {
  book: "orange",
  palette: "pink",
  brain: "purple",
  flower: "purple",
  footprints: "coral",
  dumbbell: "coral",
  coffee: "cream",
};

const GLYPHS: Readonly<Record<string, IconName>> = {
  book: "book-open",
  brain: "brain",
  coffee: "coffee",
  dumbbell: "dumbbell",
  flower: "flower-2",
  footprints: "footprints",
  palette: "palette",
  sun: "sun",
  calendar: "calendar-days",
  check: "check",
  repeat: "repeat",
  history: "history",
  pencil: "pencil",
  plus: "plus",
  users: "users",
  handshake: "handshake",
  user: "user-round",
  settings: "settings",
  completed: "circle-check",
  moon: "moon",
};

export function SeasonCommitmentRow({ row, onSelect }: SeasonCommitmentRowProps) {
  const isPaused = row.pause === "paused" || row.pause === "onHold";
  const tint = isPaused ? "neutral" : (row.habit.icon && TINTS[row.habit.icon]) || "neutral";
  const glyph = (row.habit.icon && GLYPHS[row.habit.icon]) || "flower-2";

  const subtitle =
    row.consistency !== null
      ? `${row.weightPercent} % · consistencia ${row.consistency} %`
      : `${row.weightPercent} %`;

  return (
    <button
      type="button"
      className={styles.row}
      onClick={() => onSelect?.(row.commitmentId)}
      aria-label={`${row.habit.name}, ${row.points} de ${row.weightPercent * 10} puntos`}
    >
      <span className={styles.tile} data-tint={tint} aria-hidden="true">
        <Icon name={glyph} size={20} />
      </span>

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
