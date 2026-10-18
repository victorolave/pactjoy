import { Button } from "../../../ui/Button.tsx";
import { graduationLead } from "../close-format.ts";
import { celebrationCopy } from "../copy.ts";
import styles from "../season-close.module.css";

/** Static decorative dots (design 38b): five, in brand colours, none over text. */
const DOTS = [
  { left: "14%", top: "10%", color: "var(--pj-orange)" },
  { left: "72%", top: "7%", color: "var(--pj-coral)" },
  { left: "86%", top: "20%", color: "var(--pj-pink)" },
  { left: "30%", top: "22%", color: "var(--pj-purple)" },
  { left: "58%", top: "14%", color: "var(--orange-300)" },
] as const;

export interface CelebrationStepProps {
  readonly habitName: string;
  readonly weeks: number;
  readonly consistencyPercent: number | null;
  /**
   * What the circle will read about this graduation (see `graduationNote`); `null` while it is
   * not yet known whether the habit is private, when the line stays blank but keeps its height.
   */
  readonly note: string | null;
  /** More graduated habits follow: "Siguiente hábito"; otherwise "Continuar". */
  readonly hasNext: boolean;
  readonly onNext: () => void;
}

/**
 * 38b: the graduation of one habit, on the ink background. Shown after the decisions are saved,
 * so it never celebrates something that could still be undone. The graduation is announced in the
 * circle's activity (ADR-0018, superseding the private promise of ADR-0015); the note says what
 * the circle will read, and a private habit is never named.
 */
export function CelebrationStep({
  habitName,
  weeks,
  consistencyPercent,
  note,
  hasNext,
  onNext,
}: CelebrationStepProps) {
  return (
    <main className={styles.celebrate}>
      {DOTS.map((dot) => (
        <span
          key={dot.left}
          className={styles.dot}
          aria-hidden="true"
          style={{ left: dot.left, top: dot.top, background: dot.color }}
        />
      ))}
      <div className={styles.celebrateContent}>
        <span className={styles.emoji} aria-hidden="true">
          🎓
        </span>
        <h1 className={styles.celebrateTitle}>{celebrationCopy.title(habitName)}</h1>
        <p className={styles.celebrateLead}>{graduationLead(weeks, consistencyPercent)}</p>
        {note === null ? (
          <p className={styles.celebrateNote} aria-hidden="true">
            {" "}
          </p>
        ) : (
          <p className={styles.celebrateNote}>{note}</p>
        )}
      </div>
      <div className={styles.celebrateFooter}>
        <Button block variant="inverse" onClick={onNext}>
          {hasNext ? celebrationCopy.nextHabit : celebrationCopy.onward}
        </Button>
      </div>
    </main>
  );
}
