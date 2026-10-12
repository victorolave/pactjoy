import { Button } from "../../../ui/Button.tsx";
import { FlowScreen } from "../../../ui/FlowScreen.tsx";
import { InlineMessage } from "../../../ui/InlineMessage.tsx";
import { Icon } from "../../../ui/icon/Icon.tsx";
import type { StepChrome } from "../chrome.ts";
import styles from "../review.module.css";
import {
  PRIVATE_NOTE,
  SRBAI_ITEMS,
  SRBAI_SCALE,
  type SrbaiItem,
  srbaiPhrase,
} from "../srbai-copy.ts";
import { ScaleQuestion } from "./ScaleQuestion.tsx";

export interface FullSrbaiStepProps {
  readonly chrome: StepChrome;
  readonly habitName: string;
  readonly paused: boolean;
  /** `index` from 0 among `total` commitments. */
  readonly position: { readonly index: number; readonly total: number };
  /** The commitment after this one, or `null` on the last. */
  readonly nextName: string | null;
  readonly slots: readonly (number | null)[];
  readonly onAnswer: (item: number, score: number) => void;
  readonly onNext: () => void;
  /** The review is being saved. */
  readonly pending: boolean;
  readonly offline: boolean;
  readonly error: string | null;
}

/**
 * 35a and the baseline (13): the four SRBAI phrases of ONE commitment, all required (owner
 * decision #5932). A paused commitment is still asked about and tagged "(en pausa)" (REQ-P1).
 */
export function FullSrbaiStep({
  chrome,
  habitName,
  paused,
  position,
  nextName,
  slots,
  onAnswer,
  onNext,
  pending,
  offline,
  error,
}: FullSrbaiStepProps) {
  const complete = Array.from({ length: SRBAI_ITEMS }, (_, item) => slots[item] != null).every(
    Boolean,
  );
  const last = nextName === null;
  const saving = last && (pending || offline);
  const label = !complete
    ? "Responde las 4 frases"
    : last
      ? "Terminar revisión"
      : `Siguiente: ${nextName}`;
  return (
    <FlowScreen
      title="¿Cuánto te identificas con cada frase hoy?"
      meta={`Compromiso ${position.index + 1} de ${position.total} · ${habitName}${paused ? " (en pausa)" : ""}`}
      onBack={chrome.onBack}
      backLabel={chrome.backLabel}
      backIcon={chrome.backIcon}
      progress={chrome.progress}
      footer={
        <div className={styles.footer}>
          {offline && last && (
            <InlineMessage tone="pending">
              Sin conexión. Podrás guardar la revisión cuando vuelvas a conectarte.
            </InlineMessage>
          )}
          {error !== null && <InlineMessage tone="error">{error}</InlineMessage>}
          <Button block disabled={!complete || saving} onClick={onNext}>
            {label}
          </Button>
        </div>
      }
    >
      <div className={styles.section}>
        <div className={styles.privateNote}>
          <Icon name="eye-off" size="sm" />
          {PRIVATE_NOTE}
        </div>
        {([0, 1, 2, 3] as const satisfies readonly SrbaiItem[]).map((item) => (
          <ScaleQuestion
            key={item}
            phrase={srbaiPhrase(habitName, item)}
            value={slots[item] ?? null}
            onPick={(score) => onAnswer(item, score)}
          />
        ))}
        <div className={styles.ends}>
          <span>{SRBAI_SCALE.low}</span>
          <span>{SRBAI_SCALE.high}</span>
        </div>
      </div>
    </FlowScreen>
  );
}
