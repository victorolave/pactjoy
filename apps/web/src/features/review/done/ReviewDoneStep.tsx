import { type ReactNode, useId } from "react";
import { longDate, weekdayShortDate } from "../../../shared/format.ts";
import { AutomaticityBar } from "../../../ui/AutomaticityBar.tsx";
import { Button } from "../../../ui/Button.tsx";
import { FlowScreen } from "../../../ui/FlowScreen.tsx";
import { Icon } from "../../../ui/icon/Icon.tsx";
import { Illustration } from "../../../ui/Placeholder.tsx";
import styles from "../review.module.css";

export interface ReviewDoneStepProps {
  /** What the server said when it saved; `null` when the review was already saved before. */
  readonly result: {
    readonly improvements: readonly {
      readonly commitmentId: string;
      readonly from: string;
      readonly to: string;
    }[];
    readonly nextReviewDate: string | null;
  } | null;
  /** commitmentId to habit name, to name the improvements. */
  readonly names: ReadonlyMap<string, string>;
  /** The closing review: its way on is the results of the season, not the rest of the day. */
  readonly closing?: boolean;
  /**
   * The closing review done on the grace day: the date the results open. Then the way on is the
   * rest of the day (the results screen would only say they are not ready).
   */
  readonly resultsOpenOn?: string | null;
  /**
   * The encouragement nudge (ADR-0018), placed by the flow. It is part of this screen, not a step:
   * the step bars do not change, and putting it away never affects the saved review.
   */
  readonly nudge?: ReactNode;
  readonly onFinish: () => void;
}

/** 35b: "Revisión guardada." Only the improvements are listed, then the next date as a chip. */
export function ReviewDoneStep({
  result,
  names,
  closing = false,
  resultsOpenOn = null,
  nudge,
  onFinish,
}: ReviewDoneStepProps) {
  const improvements = result?.improvements ?? [];
  const nextReviewDate = result?.nextReviewDate ?? null;
  const toResults = closing && resultsOpenOn === null;
  const listLabelId = useId();
  return (
    <FlowScreen
      title="Revisión guardada."
      centered
      illustration={
        <Illustration
          name="revision-estudiar"
          size="story"
          alt="Una persona estudia con auriculares y toma notas"
        />
      }
      footer={
        <Button block onClick={onFinish}>
          {toResults ? "Ver mis resultados" : "Seguir con mi día"}
        </Button>
      }
    >
      <div className={styles.section}>
        {improvements.length > 0 && (
          <>
            <p id={listLabelId} className={styles.small}>
              Se sienten más automáticos que al empezar
            </p>
            <ul className={styles.gains} aria-labelledby={listLabelId}>
              {improvements.map(({ commitmentId, from, to }) => {
                const name = names.get(commitmentId) ?? "Un hábito";
                return (
                  <li key={commitmentId} className={styles.gainRow}>
                    <span className={styles.gainName}>{name}</span>
                    <AutomaticityBar from={from} to={to} label={`${name}: de ${from} a ${to}`} />
                    <span className={styles.gainValue}>
                      {from} → {to}
                    </span>
                  </li>
                );
              })}
            </ul>
          </>
        )}
        {nextReviewDate !== null && (
          <p className={styles.nextReview}>
            <Icon name="calendar-days" size="sm" />
            Próxima revisión: {weekdayShortDate(nextReviewDate)}
          </p>
        )}
        {closing && resultsOpenOn !== null && (
          <p className={styles.lead}>
            Tus resultados estarán listos el {longDate(resultsOpenOn, false)}.
          </p>
        )}
        {nudge}
      </div>
    </FlowScreen>
  );
}
