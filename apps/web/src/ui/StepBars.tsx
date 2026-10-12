import { cx } from "./cx.ts";
import styles from "./StepBars.module.css";

export interface StepBarsProps {
  /** The step on screen, from 0; every bar up to and including it is filled. */
  readonly current: number;
  readonly total: number;
}

/**
 * Where you are in a short flow (design 33 to 35): a row of thin bars, the reached ones in ink. A
 * picture with one spoken label, not a control; the buttons around it move.
 */
export function StepBars({ current, total }: StepBarsProps) {
  return (
    <div className={styles.bars} role="img" aria-label={`Paso ${current + 1} de ${total}`}>
      {Array.from({ length: total }, (_, index) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: a fixed row of identical bars
          key={index}
          data-filled={index <= current}
          className={cx(styles.bar, index <= current && styles.filled)}
          aria-hidden="true"
        />
      ))}
    </div>
  );
}
