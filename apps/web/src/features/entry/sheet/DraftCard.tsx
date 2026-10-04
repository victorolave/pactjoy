import { pointsText } from "../../../shared/format.ts";
import styles from "../entry.module.css";
import type { DraftPreview } from "./draft-preview.ts";

export interface DraftCardProps {
  /** What the bar measures, for assistive tech. */
  readonly name: string;
  readonly preview: DraftPreview;
  /** Where the minimum sits along the bar, 0..1. */
  readonly minimumAt: number;
  /** Replaces the points on the right (the weekly sheet says "Progreso de la semana"). */
  readonly caption?: string;
  /** Draws what the week already had as a darker layer under the new total (design 17b). */
  readonly twoLayers?: boolean;
}

/** The sunken card under the stepper: total, points or caption, a bar with the minimum, feedback. */
export function DraftCard({
  name,
  preview,
  minimumAt,
  caption,
  twoLayers = false,
}: DraftCardProps) {
  const percent = Math.round(preview.fill * 100);
  return (
    <div className={styles.draft}>
      <div className={styles.draftHead}>
        <b>{preview.label}</b>
        {caption !== undefined ? (
          <span className={styles.draftMuted}>{caption}</span>
        ) : preview.gain === null ? null : (
          <span className={preview.gain > 0 ? styles.draftGain : styles.draftMuted}>
            {preview.gain > 0 ? pointsText(preview.gain) : "0 pts"}
          </span>
        )}
      </div>
      <div
        className={styles.draftTrack}
        role="progressbar"
        aria-label={name}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={preview.label}
      >
        <div
          className={styles.draftFill}
          style={{
            width: `${preview.fill * 100}%`,
            background: preview.reached ? "var(--gradient-together)" : "var(--ink-400)",
          }}
        />
        {twoLayers && (
          <div className={styles.draftBefore} style={{ width: `${preview.before * 100}%` }} />
        )}
        <span className={styles.draftTick} style={{ left: `${minimumAt * 100}%` }} />
      </div>
      {preview.lines.map((line) => (
        <p key={line} className={styles.draftLine}>
          {line}
        </p>
      ))}
    </div>
  );
}
