import { useNavigate } from "react-router";
import { longDate } from "../../../shared/format.ts";
import { Button } from "../../../ui/Button.tsx";
import { Card } from "../../../ui/Card.tsx";
import { useReviewOffer } from "../queries.ts";
import styles from "../review.module.css";
import { weeksPhrase } from "../review-format.ts";
import { BaselineOffer } from "./BaselineOffer.tsx";

/**
 * Today's way into a review (design 33 note: "tarjeta en Hoy"): the pending interim review, or the
 * baseline offer. The closing review is hidden: it has no screen until season-close-graduation.
 * The wording of this card is not designed yet.
 */
export function ReviewTodayCard() {
  const { pendingReview, baselineOffer } = useReviewOffer();
  const navigate = useNavigate();
  if (baselineOffer !== null) return <BaselineOffer />;
  if (pendingReview === null || pendingReview.kind === "closing") return null;
  const { seasonId, periodIndex, firstWeek, lastWeek, dueUntil } = pendingReview;
  return (
    <Card>
      <div className={styles.offer}>
        <h2 className={styles.offerTitle}>
          {`Revisión de ${weeksPhrase({ first: firstWeek, last: lastWeek })}`}
        </h2>
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
