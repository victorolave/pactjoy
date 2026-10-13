import { Card } from "../../../ui/Card.tsx";
import { Skeleton } from "../../../ui/Skeleton.tsx";
import { useProfileSummary } from "../queries.ts";
import styles from "./ProfileScreen.module.css";
import {
  CONSISTENCY_EMPTY,
  CONSISTENCY_ERROR,
  consistencyPercentText,
  consistencySeasonLines,
} from "./profile-sections.ts";

/**
 * "Consistencia histórica" (design 39): the exact pooled share of opportunities that reached the
 * minimum across the circle's seasons, the one in progress included. The percent is the server's.
 */
export function ConsistencySection() {
  const query = useProfileSummary();
  const consistency = query.data?.consistency;
  if (consistency === undefined || consistency.percent === null) {
    return (
      <section className={styles.section} aria-busy={query.isLoading}>
        <h2 className={styles.sectionTitle}>Consistencia histórica</h2>
        {query.isError ? (
          <p className={styles.note}>{CONSISTENCY_ERROR}</p>
        ) : query.isLoading || consistency === undefined ? (
          <Skeleton shape="line" />
        ) : (
          <p className={styles.note}>{CONSISTENCY_EMPTY(consistency)}</p>
        )}
      </section>
    );
  }
  return (
    <section>
      <Card>
        <div className={styles.consistency}>
          <div>
            <h2 className={styles.consistencyLabel}>Consistencia histórica</h2>
            <div className={styles.consistencyValue}>
              {consistencyPercentText(consistency.percent)}
            </div>
          </div>
          <div className={styles.consistencySeasons}>
            {consistencySeasonLines(consistency).map((line) => (
              <div key={line}>{line}</div>
            ))}
          </div>
        </div>
      </Card>
    </section>
  );
}
