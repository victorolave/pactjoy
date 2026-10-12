import { Button } from "../../../ui/Button.tsx";
import { FlowScreen } from "../../../ui/FlowScreen.tsx";
import { InlineMessage } from "../../../ui/InlineMessage.tsx";
import type { StepChrome } from "../chrome.ts";
import styles from "../review.module.css";
import { ITEM_ONE_SCALE_HINT, srbaiPhrase } from "../srbai-copy.ts";
import { ScaleQuestion } from "./ScaleQuestion.tsx";

export interface ItemOneStepProps {
  readonly chrome: StepChrome;
  readonly commitments: readonly {
    readonly commitmentId: string;
    readonly habitName: string;
    readonly paused: boolean;
  }[];
  readonly answers: Readonly<Record<string, readonly (number | null)[]>>;
  readonly onAnswer: (commitmentId: string, score: number) => void;
  readonly onFinish: () => void;
  readonly pending: boolean;
  readonly offline: boolean;
  readonly error: string | null;
}

/**
 * 35c: item 1 of the SRBAI for EVERY commitment on one screen. A paused commitment is asked about
 * too and tagged "(en pausa)" (REQ-P1). Every answer is required.
 */
export function ItemOneStep({
  chrome,
  commitments,
  answers,
  onAnswer,
  onFinish,
  pending,
  offline,
  error,
}: ItemOneStepProps) {
  const complete = commitments.every((c) => answers[c.commitmentId]?.[0] != null);
  return (
    <FlowScreen
      title="¿Cuánto te identificas con esta frase?"
      meta="Última pregunta · solo para ti"
      onBack={chrome.onBack}
      backLabel={chrome.backLabel}
      backIcon={chrome.backIcon}
      progress={chrome.progress}
      footer={
        <div className={styles.footer}>
          {offline && (
            <InlineMessage tone="pending">
              Sin conexión. Podrás guardar la revisión cuando vuelvas a conectarte.
            </InlineMessage>
          )}
          {error !== null && <InlineMessage tone="error">{error}</InlineMessage>}
          <Button block disabled={!complete || pending || offline} onClick={onFinish}>
            Terminar revisión
          </Button>
        </div>
      }
    >
      <div className={styles.section}>
        <p className={styles.small}>{ITEM_ONE_SCALE_HINT}</p>
        {commitments.map((c) => (
          <ScaleQuestion
            key={c.commitmentId}
            phrase={`${srbaiPhrase(c.habitName, 0)}${c.paused ? " (en pausa)" : ""}`}
            value={answers[c.commitmentId]?.[0] ?? null}
            onPick={(score) => onAnswer(c.commitmentId, score)}
          />
        ))}
      </div>
    </FlowScreen>
  );
}
