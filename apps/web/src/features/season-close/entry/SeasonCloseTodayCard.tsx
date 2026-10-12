import { useNavigate } from "react-router";
import { longDate } from "../../../shared/format.ts";
import { Button } from "../../../ui/Button.tsx";
import { Card } from "../../../ui/Card.tsx";
import { todayCopy } from "../copy.ts";
import { useSeasonCloseOffer } from "../queries.ts";
import styles from "../season-close.module.css";

/**
 * Today's way into the end of the season. `closingReview` renders nothing: the review card owns
 * that day, so the two never say the same thing twice. Derived on the server from the calendar
 * and the viewer's own closure; it says nothing about the other members.
 */
export function SeasonCloseTodayCard() {
  const offer = useSeasonCloseOffer();
  const navigate = useNavigate();
  const close = offer?.close ?? null;
  if (offer === null || close === null || close.step === "closingReview") return null;

  if (close.step === "resultsSoon") {
    return (
      <Card>
        <div className={styles.card}>
          <h2 className={styles.title}>{todayCopy.resultsSoonTitle}</h2>
          <p className={styles.small}>
            {todayCopy.resultsSoonBody(longDate(close.resultsFrom, false))}
          </p>
        </div>
      </Card>
    );
  }
  if (close.step === "decide") {
    return (
      <Card>
        <div className={styles.card}>
          <h2 className={styles.title}>{todayCopy.decideTitle}</h2>
          <p className={styles.small}>{todayCopy.decideBody}</p>
          <div className={styles.actions}>
            <Button onClick={() => void navigate(`/season/${offer.seasonId}/close`)}>
              {todayCopy.decideAction}
            </Button>
          </div>
        </div>
      </Card>
    );
  }
  return (
    <Card>
      <div className={styles.card}>
        <h2 className={styles.title}>{todayCopy.waitingTitle}</h2>
        <p className={styles.small}>
          {close.nextSeasonOpen ? todayCopy.waitingOpenBody : todayCopy.waitingBody}
        </p>
        {close.nextSeasonOpen && (
          <div className={styles.actions}>
            <Button onClick={() => void navigate("/season/new")}>{todayCopy.prepareNext}</Button>
          </div>
        )}
      </div>
    </Card>
  );
}
