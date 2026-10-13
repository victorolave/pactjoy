import styles from "./AutomaticityBar.module.css";

interface Journey {
  readonly from: string | null;
  readonly to: string | null;
}

/** "3,5" -> 3.5. The API sends the engine's display text, with the decimal comma. */
const score = (text: string | null): number | null => {
  if (text === null) return null;
  const value = Number(text.replace(",", "."));
  return Number.isFinite(value) ? value : null;
};

const SCALE_MIN = 1;
const SCALE_SPAN = 6;
/** A start that equals the end, or no start at all, is drawn as a small mark (percent of the track). */
const MARK_WIDTH = 2;

const positionOf = (value: number): number =>
  (Math.min(Math.max(value, SCALE_MIN), SCALE_MIN + SCALE_SPAN) - SCALE_MIN) / SCALE_SPAN;

/**
 * The span from the start to the end on the 1 to 7 scale, as percentages of the track. `null`
 * without a closing score.
 */
export function automaticityBar(journey: Journey): { left: number; width: number } | null {
  const end = score(journey.to);
  if (end === null) return null;
  const start = score(journey.from);
  if (start === null || start === end) {
    return { left: positionOf(end) * 100 - MARK_WIDTH / 2, width: MARK_WIDTH };
  }
  const low = Math.min(start, end);
  const high = Math.max(start, end);
  return { left: positionOf(low) * 100, width: (positionOf(high) - positionOf(low)) * 100 };
}

export interface AutomaticityBarProps extends Journey {
  /** What a screen reader says for the bar, e.g. "Leer: 3,5 → 4,5". */
  readonly label: string;
}

/** The automaticity track on the 1 to 7 scale, filled with the Together gradient from start to end. */
export function AutomaticityBar({ from, to, label }: AutomaticityBarProps) {
  const bar = automaticityBar({ from, to });
  if (bar === null) return null;
  return (
    <span className={styles.track} role="img" aria-label={label}>
      <span className={styles.fill} style={{ left: `${bar.left}%`, width: `${bar.width}%` }} />
    </span>
  );
}
