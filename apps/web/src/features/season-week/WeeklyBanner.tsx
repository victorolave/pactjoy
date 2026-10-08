import { useId } from "react";
import type { WeekSummary } from "../../ports/wire.ts";
import { Button } from "../../ui/Button.tsx";
import { Card } from "../../ui/Card.tsx";
import styles from "./WeekSummary.module.css";
import { bannerDetail } from "./week-labels.ts";

export interface WeeklyBannerProps {
  readonly summary: WeekSummary;
  readonly onOpen: () => void;
}

/**
 * The previous week's line in Today (design 25a): one card under the greeting, never ahead of
 * today's commitments. When it shows and when it is dismissed is the host's decision (device-local).
 */
export function WeeklyBanner({ summary, onOpen }: WeeklyBannerProps) {
  const titleId = useId();
  return (
    <Card>
      <div className={styles.banner}>
        <div className={styles.bannerBody}>
          <p id={titleId} className={styles.bannerTitle}>
            {`Semana ${summary.weekIndex + 1} cerrada`}
          </p>
          <p className={styles.small}>{bannerDetail(summary)}</p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          trailingIcon="chevron-right"
          aria-describedby={titleId}
          onClick={onOpen}
        >
          Ver
        </Button>
      </div>
    </Card>
  );
}
