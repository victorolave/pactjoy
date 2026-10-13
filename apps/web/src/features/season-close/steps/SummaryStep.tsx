import type { ClosureDecisionDto } from "../../../ports/wire.ts";
import { Badge, type BadgeTone } from "../../../ui/Badge.tsx";
import { Button } from "../../../ui/Button.tsx";
import { Card } from "../../../ui/Card.tsx";
import { FlowScreen } from "../../../ui/FlowScreen.tsx";
import { Illustration } from "../../../ui/Placeholder.tsx";
import { savedCopy } from "../copy.ts";
import styles from "../season-close.module.css";

const TONES: Readonly<Record<ClosureDecisionDto, BadgeTone>> = {
  graduate: "info",
  continue: "neutral",
  adjust: "pending",
  pause: "neutral",
};

export interface SummaryStepProps {
  /** One row per commitment, in the order of the season. */
  readonly rows: readonly {
    readonly commitmentId: string;
    readonly habitName: string;
    readonly decision: ClosureDecisionDto;
  }[];
  /** The circle may open its next season: the primary action is to prepare it. */
  readonly canPrepare: boolean;
  readonly onPrepare: () => void;
  readonly onToday: () => void;
}

/** 37b: "Decisiones guardadas." with what was decided, and the optional way on to the next season. */
export function SummaryStep({ rows, canPrepare, onPrepare, onToday }: SummaryStepProps) {
  return (
    <FlowScreen
      title={savedCopy.title}
      footer={
        <div className={styles.footer}>
          {canPrepare ? (
            <>
              <Button block onClick={onPrepare}>
                {savedCopy.prepare}
              </Button>
              <Button block variant="ghost" onClick={onToday}>
                {savedCopy.toToday}
              </Button>
            </>
          ) : (
            <Button block onClick={onToday}>
              {savedCopy.toToday}
            </Button>
          )}
        </div>
      }
    >
      <div className={styles.section}>
        <Illustration name="celebrar-juntos" size="hero" alt={savedCopy.illustrationAlt} />
        <p className={styles.lead}>{canPrepare ? savedCopy.body : savedCopy.bodyWaiting}</p>
        <Card flush>
          <ul className={styles.summaryRows} aria-label={savedCopy.listLabel}>
            {rows.map((row) => (
              <li key={row.commitmentId}>
                <b>{row.habitName}</b>
                <Badge tone={TONES[row.decision]}>{savedCopy.badges[row.decision]}</Badge>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </FlowScreen>
  );
}
