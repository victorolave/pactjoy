import { useEffect, useRef } from "react";
import type { ClosureDecisionDto, SeasonResultsCommitmentDto } from "../../../ports/wire.ts";
import { Button } from "../../../ui/Button.tsx";
import { FlowScreen } from "../../../ui/FlowScreen.tsx";
import { InlineMessage } from "../../../ui/InlineMessage.tsx";
import { HabitStageTag } from "../../review/index.ts";
import { stageLine } from "../close-format.ts";
import { decideCopy } from "../copy.ts";
import styles from "../season-close.module.css";
import type { StepChrome } from "../step-chrome.ts";

const ORDER: readonly ClosureDecisionDto[] = ["continue", "adjust", "pause", "graduate"];

export interface DecisionsStepProps {
  readonly chrome: StepChrome;
  readonly commitment: SeasonResultsCommitmentDto;
  readonly position: { readonly index: number; readonly total: number };
  readonly decision: ClosureDecisionDto | undefined;
  readonly onChoose: (decision: ClosureDecisionDto) => void;
  readonly onContinue: () => void;
  /** The last habit sends everything. */
  readonly last: boolean;
  readonly pending: boolean;
  readonly offline: boolean;
  readonly error: string | null;
}

/**
 * 37 "Decisión por hábito", one habit at a time. Nothing is preselected: the member chooses. The
 * graduation of a habit that reached `integrated` is only warmer, never louder (design 38a note).
 */
export function DecisionsStep({
  chrome,
  commitment,
  position,
  decision,
  onChoose,
  onContinue,
  last,
  pending,
  offline,
  error,
}: DecisionsStepProps) {
  const figures = stageLine(commitment);
  const heading = useRef<HTMLHeadingElement>(null);
  // A new habit is a new screen for a screen reader: the heading takes focus.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the habit changing is the trigger
  useEffect(() => heading.current?.focus(), [commitment.commitmentId]);
  return (
    <FlowScreen
      headingRef={heading}
      title={commitment.habitName}
      meta={decideCopy.habitOf(position.index + 1, position.total)}
      onBack={chrome.onBack}
      backLabel={chrome.backLabel}
      backIcon={chrome.backIcon}
      progress={chrome.progress}
      footer={
        <div className={styles.footer}>
          {error !== null && <InlineMessage tone="error">{error}</InlineMessage>}
          {last && <p className={styles.note}>{decideCopy.finalNote}</p>}
          <Button
            block
            onClick={onContinue}
            disabled={decision === undefined || pending || (last && offline)}
          >
            {pending ? decideCopy.saving : last ? decideCopy.save : decideCopy.next}
          </Button>
        </div>
      }
    >
      <div className={styles.section}>
        <div className={styles.stageRow}>
          <HabitStageTag stage={commitment.stage} />
          {figures !== "" && <span className={styles.small}>{figures}</span>}
        </div>
        <div className={styles.options} role="radiogroup" aria-label={decideCopy.group}>
          {ORDER.map((value) => {
            const option = decideCopy.options[value];
            const suggested = value === "graduate" && commitment.stage === "integrated";
            const labelId = `${commitment.commitmentId}-${value}-label`;
            const hintId = `${commitment.commitmentId}-${value}-hint`;
            return (
              <label
                key={`${commitment.commitmentId}-${value}`}
                className={`pj-check pj-check--radio ${styles.option} ${suggested ? styles.optionSuggested : ""}`}
              >
                <input
                  type="radio"
                  name={`decision-${commitment.commitmentId}`}
                  checked={decision === value}
                  onChange={() => onChoose(value)}
                  aria-labelledby={labelId}
                  aria-describedby={hintId}
                />
                <span className="pj-check__box" />
                <span className="pj-check__text">
                  <span id={labelId} className="pj-check__label">
                    {option.label}
                  </span>
                  <span id={hintId} className="pj-check__desc">
                    {option.hint}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </div>
    </FlowScreen>
  );
}
