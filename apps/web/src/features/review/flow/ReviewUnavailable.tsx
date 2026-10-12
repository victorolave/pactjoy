import { Button } from "../../../ui/Button.tsx";
import { FlowScreen } from "../../../ui/FlowScreen.tsx";
import { InlineMessage } from "../../../ui/InlineMessage.tsx";
import styles from "../review.module.css";

export interface ReviewUnavailableProps {
  readonly message: string;
  /** Present only when trying again can help. */
  readonly onRetry?: () => void;
  readonly onLeave: () => void;
}

/** A review that cannot be answered now (not due, lapsed, not found, failed to load). */
export function ReviewUnavailable({ message, onRetry, onLeave }: ReviewUnavailableProps) {
  return (
    <FlowScreen
      title="Tu revisión"
      footer={
        <div className={styles.footer}>
          {onRetry !== undefined && (
            <Button block onClick={onRetry}>
              Reintentar
            </Button>
          )}
          <Button block variant={onRetry === undefined ? "primary" : "ghost"} onClick={onLeave}>
            Volver a Hoy
          </Button>
        </div>
      }
    >
      <div className={styles.unavailable}>
        <InlineMessage tone="info">{message}</InlineMessage>
      </div>
    </FlowScreen>
  );
}
