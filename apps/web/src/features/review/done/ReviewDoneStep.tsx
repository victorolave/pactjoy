import { longDate } from "../../../shared/format.ts";
import { Button } from "../../../ui/Button.tsx";
import { FlowScreen } from "../../../ui/FlowScreen.tsx";
import { Illustration } from "../../../ui/Placeholder.tsx";
import styles from "../review.module.css";
import { doneText } from "../review-format.ts";

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
  readonly onFinish: () => void;
}

/** 35b: "Revisión guardada." Only the improvements are named; with none, only the next date. */
export function ReviewDoneStep({
  result,
  names,
  closing = false,
  resultsOpenOn = null,
  onFinish,
}: ReviewDoneStepProps) {
  const text = result === null ? "" : doneText(result, names);
  const toResults = closing && resultsOpenOn === null;
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
        {text !== "" && <p className={styles.lead}>{text}</p>}
        {closing && resultsOpenOn !== null && (
          <p className={styles.lead}>
            Tus resultados estarán listos el {longDate(resultsOpenOn, false)}.
          </p>
        )}
      </div>
    </FlowScreen>
  );
}
