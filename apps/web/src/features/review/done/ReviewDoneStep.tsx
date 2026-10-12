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
  readonly onFinish: () => void;
}

/** 35b: "Revisión guardada." Only the improvements are named; with none, only the next date. */
export function ReviewDoneStep({ result, names, closing = false, onFinish }: ReviewDoneStepProps) {
  const text = result === null ? "" : doneText(result, names);
  return (
    <FlowScreen
      title="Revisión guardada."
      footer={
        <Button block onClick={onFinish}>
          {closing ? "Ver mis resultados" : "Seguir con mi día"}
        </Button>
      }
    >
      <div className={styles.section}>
        <Illustration name="registro-guardado" size="hero" alt="Revisión guardada" />
        {text !== "" && <p className={styles.lead}>{text}</p>}
      </div>
    </FlowScreen>
  );
}
