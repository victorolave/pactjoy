import styles from "../review.module.css";
import { SRBAI_SCALE } from "../srbai-copy.ts";

const SCORES = Array.from(
  { length: SRBAI_SCALE.max - SRBAI_SCALE.min + 1 },
  (_, i) => SRBAI_SCALE.min + i,
);

export interface ScaleQuestionProps {
  readonly phrase: string;
  readonly value: number | null;
  readonly onPick: (score: number) => void;
}

/** One phrase with its 1 to 7 scale (35a, 35c, 13): a group of toggle buttons, one pressed at most. */
export function ScaleQuestion({ phrase, value, onPick }: ScaleQuestionProps) {
  return (
    <fieldset className={styles.question} aria-label={phrase}>
      <legend className={styles.questionText} aria-hidden="true">
        {phrase}
      </legend>
      <div className={styles.scale}>
        {SCORES.map((score) => (
          <button
            key={score}
            type="button"
            className={styles.scaleButton}
            aria-pressed={value === score}
            onClick={() => onPick(score)}
          >
            {score}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
