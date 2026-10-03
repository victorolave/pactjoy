import styles from "./ProgressBar.module.css";

export interface ProgressMark {
  /** Position on the same scale as `value` and `max`. */
  readonly at: number;
  readonly label: string;
}

export interface ProgressBarProps {
  /** What the bar measures, for assistive tech. */
  readonly name: string;
  readonly value: number;
  readonly max: number;
  readonly label?: string;
  readonly valueLabel?: string;
  readonly hint?: string;
  /** Labelled positions, e.g. the minimum and the ideal of a commitment. */
  readonly marks?: readonly ProgressMark[];
  readonly tone?: "gradient" | "ink" | "success";
  /**
   * Where the commitment's minimum sits on the same scale as `value`. Below it the fill is the
   * neutral ink-400 (nothing counts yet); the gradient starts only once it is reached (design 17).
   */
  readonly minimum?: number;
  /** The track colour: the page's sunken surface, or white inside a sunken card. */
  readonly track?: "sunken" | "white";
}

const NEUTRAL_FILL = "var(--ink-400)";

const FILL = {
  gradient: "var(--gradient-together)",
  ink: "var(--pj-ink)",
  success: "var(--pj-success)",
} as const;

const fraction = (value: number, max: number): number =>
  max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;

export function ProgressBar({
  name,
  value,
  max,
  label,
  valueLabel,
  hint,
  marks = [],
  tone = "gradient",
  minimum,
  track = "sunken",
}: ProgressBarProps) {
  const belowMinimum = minimum !== undefined && value < minimum;
  const fill = tone === "gradient" && belowMinimum ? NEUTRAL_FILL : FILL[tone];
  const text = valueLabel ?? `${value} de ${max}`;
  return (
    <div className="pj-progress">
      {(label !== undefined || valueLabel !== undefined) && (
        <div className="pj-progress__head">
          {label !== undefined && <span className="pj-progress__label">{label}</span>}
          <span className="pj-progress__value">{text}</span>
        </div>
      )}
      <div className={styles.trackWrap}>
        <div
          className={`pj-progress__track ${styles.track}`}
          data-track={track}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={max}
          aria-label={name}
          aria-valuenow={Math.max(0, Math.min(value, max))}
          aria-valuetext={text}
        >
          <div
            className="pj-progress__fill"
            style={{ width: `${fraction(value, max) * 100}%`, background: fill }}
          />
        </div>
        {marks.map((mark, index) => {
          const at = fraction(mark.at, max);
          // The end of the bar needs no tick; the others show where a threshold sits (design 15a).
          return at > 0 && at < 1 ? (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: static list
              key={index}
              className={styles.tick}
              style={{ left: `${at * 100}%` }}
              aria-hidden="true"
            />
          ) : null;
        })}
      </div>
      {marks.length > 0 && (
        <div className={styles.marks}>
          {marks.map((mark, index) => {
            const at = fraction(mark.at, max);
            return (
              <span
                // Two marks can share a label; the list is static, so index plus label is stable.
                // biome-ignore lint/suspicious/noArrayIndexKey: see above
                key={`${index}-${mark.label}`}
                className={styles.mark}
                style={{ left: `${at * 100}%` }}
                {...(at === 1 ? { "data-edge": "end" } : {})}
              >
                {mark.label}
              </span>
            );
          })}
        </div>
      )}
      {hint !== undefined && <span className="pj-progress__hint">{hint}</span>}
    </div>
  );
}
