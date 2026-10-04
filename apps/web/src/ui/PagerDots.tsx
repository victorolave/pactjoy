import { cx } from "./cx.ts";
import styles from "./PagerDots.module.css";

export interface PagerDotsProps {
  /** How many pages there are. */
  readonly count: number;
  /** The current page, from 0. */
  readonly current: number;
}

/**
 * Where you are in a short sequence (design 1a-c): a row of dots, the current one stretched. It is
 * a picture with one spoken label ("Pantalla 2 de 3"), not a control: the buttons around it move.
 */
export function PagerDots({ count, current }: PagerDotsProps) {
  return (
    <div className={styles.dots} role="img" aria-label={`Pantalla ${current + 1} de ${count}`}>
      {Array.from({ length: count }, (_, index) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: a fixed row of identical dots
          key={index}
          className={cx(styles.dot, index === current && styles.current)}
          aria-hidden="true"
        />
      ))}
    </div>
  );
}
