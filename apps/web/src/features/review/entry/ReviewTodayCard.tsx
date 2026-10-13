import { useNavigate } from "react-router";
import { longDate } from "../../../shared/format.ts";
import { Button } from "../../../ui/Button.tsx";
import { Card } from "../../../ui/Card.tsx";
import { useReviewOffer } from "../queries.ts";
import styles from "../review.module.css";
import { weeksPhrase } from "../review-format.ts";
import { BaselineOffer } from "./BaselineOffer.tsx";

/**
 * Today's way into a review (design 33 note: "tarjeta en Hoy"): the pending interim or closing
 * review, or the baseline offer. The closing review is titled "Revisión de cierre" and has no
 * deadline of its own (it closes with the season). The wording of this card is not designed yet.
 */
export function ReviewTodayCard() {
  const { pendingReview, baselineOffer } = useReviewOffer();
  const navigate = useNavigate();
  if (baselineOffer !== null) return <BaselineOffer />;
  if (pendingReview === null) return null;
  const { seasonId, periodIndex, firstWeek, lastWeek, dueUntil } = pendingReview;
  const title =
    pendingReview.kind === "closing"
      ? "Revisión de cierre"
      : `Revisión de ${weeksPhrase({ first: firstWeek, last: lastWeek })}`;
  return (
    <Card>
      <div className={styles.offer}>
        <h2 className={styles.offerTitle}>{title}</h2>
        <p className={styles.small}>Solo para ti, unos 60 segundos.</p>
        {dueUntil !== null && (
          <p className={styles.small}>{`Hasta el ${longDate(dueUntil, false)}`}</p>
        )}
        <div className={styles.offerActions}>
          <Button onClick={() => void navigate(`/review/${seasonId}/${periodIndex}`)}>
            Hacer la revisión
          </Button>
        </div>
      </div>
    </Card>
  );
}
