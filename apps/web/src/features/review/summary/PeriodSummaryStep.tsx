import type { ReviewDraftDto } from "../../../ports/wire.ts";
import { Button } from "../../../ui/Button.tsx";
import { Card } from "../../../ui/Card.tsx";
import { FlowScreen } from "../../../ui/FlowScreen.tsx";
import { InlineMessage } from "../../../ui/InlineMessage.tsx";
import type { StepChrome } from "../chrome.ts";
import styles from "../review.module.css";
import {
  commitmentFigures,
  percentText,
  periodHeading,
  periodMeta,
  pointsLabel,
} from "../review-format.ts";

/** 33: how the period went, read live from the Entries (A1). The same on every device and visit. */
export interface PeriodSummaryStepProps {
  readonly chrome: StepChrome;
  readonly draft: ReviewDraftDto;
  readonly onNext: () => void;
}

export function PeriodSummaryStep({ chrome, draft, onNext }: PeriodSummaryStepProps) {
  const { summary, weeks } = draft;
  return (
    <FlowScreen
      title={weeks === null ? "Tu revisión" : periodHeading(weeks)}
      {...(weeks === null ? {} : { meta: periodMeta(weeks) })}
      onBack={chrome.onBack}
      backLabel={chrome.backLabel}
      backIcon={chrome.backIcon}
      progress={chrome.progress}
      footer={
        <Button block onClick={onNext}>
          Continuar
        </Button>
      }
    >
      <div className={styles.section}>
        {summary !== null && (
          <>
            {!summary.final && (
              <InlineMessage tone="info">
                Las cifras de la última semana todavía pueden cambiar.
              </InlineMessage>
            )}
            <section className={styles.totals} aria-label="Totales del periodo">
              <Card>
                <div className={styles.total}>
                  <div className={styles.totalLabel}>Consistencia</div>
                  <div className={styles.totalValue}>
                    {percentText(summary.totals.consistencyPercent)}
                  </div>
                </div>
              </Card>
              <Card>
                <div className={styles.total}>
                  <div className={styles.totalLabel}>Ideal</div>
                  <div className={styles.totalValue}>
                    {percentText(summary.totals.idealPercent)}
                  </div>
                </div>
              </Card>
              <Card>
                <div className={styles.total}>
                  <div className={styles.totalLabel}>Puntos</div>
                  <div className={styles.totalValue}>{pointsLabel(summary.totals.points)}</div>
                </div>
              </Card>
            </section>
            <Card>
              <ul className={styles.rows} aria-label="Compromisos del periodo">
                {summary.commitments.map((row) => (
                  <li key={row.commitmentId} className={styles.figureRow}>
                    <b>{row.habitName}</b>
                    <span className={styles.figureText}>{commitmentFigures(row)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          </>
        )}
      </div>
    </FlowScreen>
  );
}
