import { cx } from "../../ui/cx.ts";
import styles from "./entry.module.css";

/** Most options the grid shows: past this the user types the number instead. */
const MAX_OPTION = 12;
const MIN_OPTIONS = 5;

/** 0 to 5, or one past the tolerance when that is further; every option is an exact whole quantity. */
export function limitOptions(tolerance: number): number[] {
  const last = Math.min(MAX_OPTION, Math.max(MIN_OPTIONS, Math.ceil(tolerance) + 1));
  return Array.from({ length: last + 1 }, (_, index) => index);
}

/** The grid's options, plus the chosen value when it is outside them (editing a stored entry). */
function optionsWith(tolerance: number, value: number | null): number[] {
  const options = limitOptions(tolerance);
  return value === null || options.includes(value) ? options : [...options, value];
}

function zoneOf(option: number, ideal: number, tolerance: number): string {
  if (option <= ideal) return "Ideal";
  return option <= tolerance ? "Tolerancia" : "Excede";
}

export interface LimitGridProps {
  readonly unit: string;
  readonly ideal: number;
  readonly tolerance: number;
  readonly value: number | null;
  readonly onSelect: (value: number) => void;
}

/**
 * A grid of every quantity, 0 included and just as big, so logging "none" costs the same two taps as
 * logging 3. Each option says its zone only: points are the server's (P3).
 */
export function LimitGrid({ unit, ideal, tolerance, value, onSelect }: LimitGridProps) {
  return (
    <div className={styles.grid} role="radiogroup" aria-label={`Cantidad de ${unit}`}>
      {optionsWith(tolerance, value).map((option) => (
        // biome-ignore lint/a11y/useSemanticElements: a button-based radio group, like the design system's
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={value === option}
          className={cx(styles.option, value === option && styles.optionOn)}
          onClick={() => onSelect(option)}
        >
          <span className={styles.optionNumber}>{option}</span>
          <span className={styles.optionZone}>{zoneOf(option, ideal, tolerance)}</span>
        </button>
      ))}
    </div>
  );
}
