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
  /**
   * What each whole number scores, in percent, indexed by the number: the server's (`limitPercents`).
   * Without it an option says its zone instead.
   */
  readonly percents?: readonly number[] | null;
  readonly onSelect: (value: number) => void;
}

/**
 * A grid of every quantity, 0 included and just as big, so logging "none" costs the same two taps as
 * logging 3. Each option shows what it scores before it is chosen (design 18); the last one past the
 * tolerance reads "5+".
 */
export function LimitGrid({
  unit,
  ideal,
  tolerance,
  value,
  percents = null,
  onSelect,
}: LimitGridProps) {
  const options = optionsWith(tolerance, value);
  // The open end is the grid's own last option, not a stored value that happens to lie outside it.
  const last = limitOptions(tolerance).at(-1);
  return (
    <div className={styles.grid} role="radiogroup" aria-label={`Cantidad de ${unit}`}>
      {options.map((option) => {
        const percent = percents?.[option];
        const open = option === last && option > tolerance;
        return (
          // biome-ignore lint/a11y/useSemanticElements: a button-based radio group, like the design system's
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={value === option}
            className={cx(styles.option, value === option && styles.optionOn)}
            onClick={() => onSelect(option)}
          >
            <span className={styles.optionNumber}>{open ? `${option}+` : option}</span>
            <span className={styles.optionZone}>{zoneOf(option, ideal, tolerance)}</span>
            {percent !== undefined && <span className={styles.optionZone}>{`${percent} %`}</span>}
          </button>
        );
      })}
    </div>
  );
}
