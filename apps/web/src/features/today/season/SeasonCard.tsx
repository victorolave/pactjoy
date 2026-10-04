import { Card } from "../../../ui/Card.tsx";
import { cx } from "../../../ui/cx.ts";
import type { SeasonCardModel } from "../today-view-model.ts";
import styles from "./cards.module.css";

/** The viewer's season at a glance. Everything shown is server-computed. */
export function SeasonCard({ model }: { readonly model: SeasonCardModel }) {
  return (
    <Card as="section" flush tone="inverse">
      <div className={styles.season}>
        <span className={styles.seasonBar} aria-hidden="true" />
        <div className={styles.seasonHead}>
          <span className={styles.seasonTitle}>Tu temporada</span>
          <span className={styles.seasonMeta}>{model.weekLabel}</span>
        </div>
        <div className={styles.seasonBody}>
          <div className={styles.points}>
            <span>{model.points}</span>
            <span className={styles.unit}>pts</span>
          </div>
          <div className={styles.rates}>
            <b>Consistencia {model.consistency}</b>
            <span>Ideal {model.idealCompletion}</span>
          </div>
        </div>
        <div className={styles.weeks} aria-hidden="true">
          {Array.from({ length: model.weekCount }, (_, index) => (
            <span
              // Segments are identical and never reorder.
              // biome-ignore lint/suspicious/noArrayIndexKey: static decorative list
              key={index}
              className={cx(styles.week, index < model.week && styles.weekDone)}
            />
          ))}
        </div>
        <span className={styles.seasonMeta}>{model.daysLeftLabel}</span>
      </div>
    </Card>
  );
}
