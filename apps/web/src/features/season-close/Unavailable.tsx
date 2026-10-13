import { Button } from "../../ui/Button.tsx";
import { FlowScreen } from "../../ui/FlowScreen.tsx";
import { InlineMessage } from "../../ui/InlineMessage.tsx";
import { resultsCopy } from "./copy.ts";
import styles from "./season-close.module.css";

export interface UnavailableProps {
  readonly message: string;
  /** Present only when trying again can help. */
  readonly onRetry?: () => void;
  /** Present when the closing review has to come first. */
  readonly onReview?: () => void;
  readonly onLeave: () => void;
}

/** A close that cannot be shown or saved now (too early, closed, nothing to decide, failed to load). */
export function Unavailable({ message, onRetry, onReview, onLeave }: UnavailableProps) {
  const primary = onReview ?? onRetry;
  return (
    <FlowScreen
      title={resultsCopy.screenTitle}
      footer={
        <div className={styles.footer}>
          {onReview !== undefined && (
            <Button block onClick={onReview}>
              {resultsCopy.review}
            </Button>
          )}
          {onReview === undefined && onRetry !== undefined && (
            <Button block onClick={onRetry}>
              Reintentar
            </Button>
          )}
          <Button block variant={primary === undefined ? "primary" : "ghost"} onClick={onLeave}>
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
